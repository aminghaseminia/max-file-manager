import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { createEngine, type JobKind } from './jobs.ts'
import { remove } from './ops.ts'
import { findDupes, walk, type WalkOpts } from './search.ts'
import type { DirRef, Entry } from './types.ts'

// mfm:// serves local files to <img> so the renderer never gets a filesystem API.
protocol.registerSchemesAsPrivileged([
  { scheme: 'mfm', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

/** Sizes/mtimes need one stat per file; chunked so a 10k-file folder can't exhaust fds. */
async function fillStats(entries: Entry[]): Promise<void> {
  for (let i = 0; i < entries.length; i += 128) {
    await Promise.all(
      entries.slice(i, i + 128).map(async (e) => {
        const st = await fs.stat(e.path).catch(() => null) // follows symlinks; broken link keeps dirent type
        if (!st) return
        e.dir = st.isDirectory()
        e.size = st.size
        e.mtime = st.mtimeMs
      })
    )
  }
}

async function list(dir: string, showHidden: boolean) {
  const dirents = await fs.readdir(dir, { withFileTypes: true })
  const entries: Entry[] = dirents
    .filter((d) => showHidden || !d.name.startsWith('.'))
    .map((d) => ({
      name: d.name,
      path: path.join(dir, d.name),
      dir: d.isDirectory(),
      size: 0,
      mtime: 0,
      ext: path.extname(d.name).slice(1).toLowerCase()
    }))
  await fillStats(entries)
  const parent = path.dirname(dir)
  return { path: dir, parent: parent === dir ? null : parent, entries }
}

/** Subfolders only, no stat: what the sidebar tree needs. */
async function dirs(dir: string): Promise<DirRef[]> {
  const kids = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  return kids
    .filter((k) => k.isDirectory() && !k.name.startsWith('.'))
    .map((k) => ({ name: k.name, path: path.join(dir, k.name) }))
}

const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false)

/** Mount points + home, so removable media show up without a volume manager. */
async function roots(): Promise<DirRef[]> {
  const out: DirRef[] = []
  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const p = `${letter}:\\`
      if (await isDir(p)) out.push({ name: p, path: p })
    }
    return out
  }
  out.push({ name: '/', path: '/' }, { name: '~', path: os.homedir() })
  const user = os.userInfo().username
  for (const base of ['/mnt', `/media/${user}`, `/run/media/${user}`]) {
    const kids = await fs.readdir(base, { withFileTypes: true }).catch(() => [])
    for (const k of kids) if (k.isDirectory()) out.push({ name: k.name, path: path.join(base, k.name) })
  }
  return out
}

// shortcut: folder size stops at 200k entries / 4s and admits it; upgrade to a worker + cache table.
async function dirSize(root: string): Promise<{ bytes: number; files: number; capped: boolean }> {
  let bytes = 0
  let files = 0
  let capped = false
  const deadline = Date.now() + 4000
  const stack = [root]
  while (stack.length) {
    if (files > 200_000 || Date.now() > deadline) {
      capped = true
      break
    }
    const dir = stack.pop()!
    const kids = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const k of kids) {
      const p = path.join(dir, k.name)
      if (k.isDirectory()) stack.push(p)
      else {
        const st = await fs.stat(p).catch(() => null)
        if (st) {
          bytes += st.size
          files++
        }
      }
    }
  }
  return { bytes, files, capped }
}

const stateFile = () => path.join(app.getPath('userData'), 'state.json')

async function readState(): Promise<unknown> {
  const raw = await fs.readFile(stateFile(), 'utf8').catch(() => '')
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 760,
    minHeight: 460,
    backgroundColor: '#16181d',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.on('ready-to-show', () => win.show())
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(() => {
  protocol.handle('mfm', (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname)
    if (!path.isAbsolute(p)) return new Response('bad path', { status: 400 })
    return net.fetch(pathToFileURL(p).toString())
  })

  const win = createWindow()
  const engine = createEngine((job) => {
    if (!win.isDestroyed()) win.webContents.send('job:update', job)
  })

  ipcMain.handle('fs:list', (_e, dir: string, showHidden: boolean) => list(dir, showHidden))
  ipcMain.handle('fs:dirs', (_e, dir: string) => dirs(dir))
  ipcMain.handle('fs:roots', () => roots())
  ipcMain.handle('fs:home', () => os.homedir())
  ipcMain.handle('fs:size', (_e, p: string) =>
    path.isAbsolute(p) ? dirSize(p) : { bytes: 0, files: 0, capped: true }
  )
  ipcMain.handle('fs:remove', (_e, a: { paths: string[]; permanent: boolean }) =>
    remove(a.paths ?? [], a.permanent ? {} : { trash: (p) => shell.trashItem(p) })
  )
  ipcMain.handle('fs:walk', (_e, dir: string, opts: WalkOpts) =>
    path.isAbsolute(dir) ? walk(dir, opts ?? {}) : { entries: [], scanned: 0, capped: false }
  )
  ipcMain.handle('fs:dupes', (_e, dir: string) =>
    path.isAbsolute(dir) ? findDupes(dir) : { entries: [], capped: false }
  )
  ipcMain.handle('fs:mkdir', (_e, dir: string, name: string) => engine.makeDir(dir, name))
  ipcMain.handle('fs:renameMany', (_e, pairs: { from: string; to: string }[]) =>
    engine.renameMany(pairs ?? [])
  )
  ipcMain.handle('job:start', (_e, a: { kind: JobKind; sources: string[]; dest: string }) =>
    engine.start(a.kind, a.sources ?? [], a.dest)
  )
  ipcMain.handle('job:pause', (_e, id: string) => engine.pause(id))
  ipcMain.handle('job:resume', (_e, id: string) => engine.resume(id))
  ipcMain.handle('job:cancel', (_e, id: string) => engine.cancel(id))
  ipcMain.handle('job:list', () => engine.list())
  ipcMain.handle('job:clear', () => engine.clear())
  ipcMain.handle('undo:run', () => engine.undo())
  ipcMain.handle('undo:depth', () => engine.undoDepth())
  ipcMain.handle('shell:open', (_e, p: string) =>
    path.isAbsolute(p) ? shell.openPath(p) : Promise.resolve('bad path')
  )
  ipcMain.handle('state:get', () => readState())
  ipcMain.handle('state:set', async (_e, s: unknown) => {
    await fs.mkdir(path.dirname(stateFile()), { recursive: true })
    await fs.writeFile(stateFile(), JSON.stringify(s, null, 2))
    return true
  })

  // SMOKE_SHOT=<file.png> renders the window once, saves a screenshot and quits; SMOKE_JS drives the UI first.
  const shot = process.env['SMOKE_SHOT']
  const js = process.env['SMOKE_JS']
  if (shot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (js) await win.webContents.executeJavaScript(js).catch((e) => console.log('SMOKE_JS_ERR ' + e))
        await new Promise((r) => setTimeout(r, 900))
        const img = await win.webContents.capturePage()
        await fs.writeFile(shot, img.toPNG())
        console.log('SMOKE_OK ' + shot)
        app.quit()
      }, 900)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
