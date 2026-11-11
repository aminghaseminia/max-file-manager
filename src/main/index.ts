import { app, BrowserWindow, globalShortcut, ipcMain, nativeImage, net, protocol, shell } from 'electron'
import { readFileSync, promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { extract, listArchive, createZip, type ZipLevel } from './archives.ts'
import { saveImage } from './image.ts'
import { hashMany } from './hash.ts'
import { iconsIn, themeDirs } from './icons.ts'
import { preview } from './preview.ts'
import { LABELS, readMeta, setLabel, setMeta, setNote, setRating, togglePin, type FolderMeta } from './meta.ts'
import { htmlToPdf, readTextFile, writeTextFile } from './editor.ts'
import { openTerminal, revealFile, startFileDrag } from './desktop.ts'
import { applySync, compareTrees, diffFiles, type SyncRow } from './sync.ts'
import { convertImages, type ConvertOpts } from './convert.ts'
import { exportListing, type ExportRow } from './export.ts'
import { createEngine, type JobKind, type JobOpts } from './jobs.ts'
import { remove } from './ops.ts'
import { findDupes, walk, type WalkOpts } from './search.ts'
import type { DirRef, Entry } from './types.ts'

// mfm:// serves local files to <img> so the renderer never gets a filesystem API.
protocol.registerSchemesAsPrivileged([
  { scheme: 'mfm', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

type Chrome = { customTitlebar: boolean; rounded: boolean }

const statePath = () => path.join(app.getPath('userData'), 'state.json')

/** Read synchronously, before `ready`: frame/transparent and the instance lock need it that early. */
function bootState(): any {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'))
  } catch {
    return {}
  }
}

const boot = bootState()
const bootPrefs = boot.prefs ?? {}

// frame/transparent are window-construction options, so the chrome choice is read before the window exists
let chrome: Chrome = {
  customTitlebar: bootPrefs.titlebar !== 'system' && boot.chrome?.customTitlebar !== false,
  rounded: bootPrefs.rounded !== false && boot.chrome?.rounded !== false
}
let win: BrowserWindow | null = null

const firstPath = process.argv.slice(1).find((a) => path.isAbsolute(a))

// single instance: a second launch focuses the window and opens the path it was given
if (bootPrefs.singleInstance !== false) {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
  } else {
    app.on('second-instance', (_e, argv) => {
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      const target = argv.slice(1).find((a) => path.isAbsolute(a))
      if (target) win.webContents.send('app:open-path', target)
    })
  }
}

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
        e.mode = st.mode
        e.uid = st.uid
        e.gid = st.gid
        e.nlink = st.nlink
      })
    )
  }
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'])

async function list(dir: string, showHidden: boolean, dims = false) {
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
  // folder look comes from the folder's own marker file; capped so a 5k-folder directory stays quick
  const folders = entries.filter((e) => e.dir).slice(0, 1000)
  for (let i = 0; i < folders.length; i += 64) {
    await Promise.all(
      folders.slice(i, i + 64).map(async (e) => {
        const m = await readMeta(e.path)
        if (m?.color) e.color = m.color
        if (m?.icon) e.icon = m.icon
      })
    )
  }
  // pixel size needs a decoder, so it is opt-in and capped
  if (dims) {
    const images = entries.filter((e) => !e.dir && IMAGE_EXT.has(e.ext) && e.size < 20_000_000).slice(0, 400)
    for (const e of images) {
      const size = nativeImage.createFromPath(e.path).getSize()
      if (size.width) {
        e.w = size.width
        e.h = size.height
      }
    }
  }
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

async function readState(): Promise<any> {
  const raw = await fs.readFile(stateFile(), 'utf8').catch(() => '')
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Writes only the chrome key, so the renderer's session state is never clobbered. */
async function saveChrome(next: Chrome): Promise<void> {
  const st = (await readState()) ?? {}
  st.chrome = next
  await fs.mkdir(path.dirname(stateFile()), { recursive: true })
  await fs.writeFile(stateFile(), JSON.stringify(st, null, 2))
}

function createWindow(): BrowserWindow {
  const frameless = chrome.customTitlebar
  const transparent = frameless && chrome.rounded
  const w = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 780,
    minHeight: 480,
    frame: !frameless,
    transparent,
    backgroundColor: transparent ? '#00000000' : '#16181d',
    hasShadow: true,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  w.on('ready-to-show', () => w.show())
  w.on('maximize', () => w.webContents.send('window:maximized', true))
  w.on('unmaximize', () => w.webContents.send('window:maximized', false))
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) w.loadURL(devUrl)
  else w.loadFile(path.join(__dirname, '../renderer/index.html'))
  return w
}

app.on('will-quit', () => globalShortcut.unregisterAll())

app.whenReady().then(async () => {
  protocol.handle('mfm', async (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname)
    if (!path.isAbsolute(p)) return new Response('bad path', { status: 400 })
    const res = await net.fetch(pathToFileURL(p).toString())
    // without CORS the renderer can display the image but a canvas stays tainted and cannot be saved
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, { status: res.status, headers })
  })

  win = createWindow()
  const engine = createEngine((job) => {
    if (win && !win.isDestroyed()) win.webContents.send('job:update', job)
  })

  ipcMain.handle('fs:list', async (_e, dir: string, showHidden: boolean, dims = false) => {
    const l = await list(dir, showHidden, dims)
    const meta = path.isAbsolute(dir) ? await readMeta(dir) : null
    return {
      ...l,
      pins: meta?.pins ?? [],
      labels: meta?.labels ?? {},
      ratings: meta?.ratings ?? {},
      notes: meta?.notes ?? {}
    }
  })
  ipcMain.handle('fs:statfs', async (_e, p: string) => {
    if (!path.isAbsolute(p)) return null
    const s = await fs.statfs(p).catch(() => null)
    return s ? { free: Number(s.bavail) * Number(s.bsize), size: Number(s.blocks) * Number(s.bsize) } : null
  })
  ipcMain.handle('fs:imageData', async (_e, p: string) => {
    if (!path.isAbsolute(p)) return { error: 'مسیر نامعتبر' }
    const st = await fs.stat(p).catch(() => null)
    if (!st || st.size > 40_000_000) return { error: 'فایل بیش از ۴۰ مگابایت است' }
    const ext = path.extname(p).slice(1).toLowerCase()
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext === 'webp' ? 'webp' : 'png'
    const buf = await fs.readFile(p).catch(() => null)
    if (!buf) return { error: 'خواندن فایل ممکن نشد' }
    return { dataUrl: `data:image/${mime};base64,${buf.toString('base64')}` }
  })
  ipcMain.handle('image:save', (_e, a: { src: string; dataUrl: string; mode: 'overwrite' | 'copy' }) =>
    saveImage(a.src, a.dataUrl, a.mode)
  )
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
  ipcMain.handle('fs:archive', (_e, p: string) =>
    path.isAbsolute(p) ? listArchive(p) : { entries: [], capped: false }
  )
  ipcMain.handle(
    'fs:archiveCreate',
    (_e, a: { dir: string; name: string; sources: string[]; level?: number }) =>
      createZip(
        a?.dir ?? '',
        String(a?.name ?? 'archive'),
        a?.sources ?? [],
        Math.min(9, Math.max(0, Number(a?.level ?? 6))) as ZipLevel
      )
  )
  ipcMain.handle('fs:extract', (_e, a: { archive: string; names: string[]; dest: string }) =>
    path.isAbsolute(a.archive) && path.isAbsolute(a.dest)
      ? extract(a.archive, a.names ?? [], a.dest)
      : { done: 0, errors: ['مسیر نامعتبر'] }
  )
  ipcMain.handle('meta:set', (_e, a: { dir: string; meta: FolderMeta }) =>
    path.isAbsolute(a.dir) ? setMeta(a.dir, a.meta ?? {}) : null
  )
  ipcMain.handle('hotkey:register', (_e, accel: string) => {
    globalShortcut.unregisterAll()
    const a = String(accel ?? '').trim()
    if (!a) return { ok: false, accel: '' }
    // Win+E is owned by Explorer on Windows and needs a portal on Wayland; the caller shows the result
    const ok = globalShortcut.register(a, () => {
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })
    return { ok, accel: a }
  })
  ipcMain.handle('app:terminal', (_e, dir: string) => openTerminal(dir ?? ''))
  ipcMain.handle('app:reveal', (_e, p: string) => revealFile(p ?? ''))
  ipcMain.on('app:dragOut', (e, files: string[]) => {
    void startFileDrag(e.sender, files ?? [])
  })
  ipcMain.handle('image:batchConvert', (_e, a: { files: string[]; opts: ConvertOpts }) =>
    convertImages((a?.files ?? []).slice(0, 500), a?.opts ?? { format: 'jpeg', maxSide: 0, quality: 90 })
  )
  ipcMain.handle(
    'export:listing',
    (
      _e,
      a: { dir: string; name: string; rows: ExportRow[]; format: 'csv' | 'pdf'; theme?: string }
    ) =>
      exportListing(
        a?.dir ?? '',
        String(a?.name ?? 'listing'),
        a?.rows ?? [],
        a?.format ?? 'csv',
        a?.theme ?? 'dark'
      )
  )
  ipcMain.handle(
    'sync:compare',
    (_e, a: { left: string; right: string; deep?: boolean; compareBy?: 'mtime' | 'ctime' | 'hash'; ignore?: string[] }) =>
      compareTrees(a?.left ?? '', a?.right ?? '', !!a?.deep, {
        compareBy: a?.compareBy,
        ignore: Array.isArray(a?.ignore) ? a.ignore.slice(0, 50) : []
      })
  )
  ipcMain.handle(
    'sync:apply',
    (_e, a: { left: string; right: string; rows: SyncRow[]; mode: 'ltr' | 'rtl'; deleteExtra?: boolean }) =>
      applySync(a.left, a.right, a.rows ?? [], a.mode, !!a.deleteExtra, (p) => shell.trashItem(p))
  )
  ipcMain.handle('fs:diff', (_e, a: { a: string; b: string }) => diffFiles(a?.a ?? '', a?.b ?? ''))
  ipcMain.handle('fs:readText', (_e, p: string) => readTextFile(p ?? ''))
  ipcMain.handle('fs:writeText', (_e, a: { path: string; text: string }) =>
    writeTextFile(a?.path ?? '', String(a?.text ?? ''))
  )
  ipcMain.handle('pdf:html', (_e, a: { html: string; out: string; theme?: string }) =>
    htmlToPdf(String(a?.html ?? ''), a?.out ?? '', a?.theme ?? 'dark')
  )
  ipcMain.handle('fs:preview', (_e, p: string, maxKB?: number) =>
    path.isAbsolute(p) ? preview(p, maxKB) : null
  )
  ipcMain.handle('fs:hash', (_e, paths: string[], algo: string) =>
    hashMany((paths ?? []).filter((p) => path.isAbsolute(p)), algo || 'sha256')
  )
  ipcMain.handle('meta:get', (_e, dir: string) => (path.isAbsolute(dir) ? readMeta(dir) : null))
  ipcMain.handle('meta:setRating', (_e, a: { dir: string; name: string; stars: number }) =>
    path.isAbsolute(a?.dir ?? '') ? setRating(a.dir, String(a.name ?? ''), Number(a.stars ?? 0)) : {}
  )
  ipcMain.handle('meta:setNote', (_e, a: { dir: string; name: string; text: string }) =>
    path.isAbsolute(a?.dir ?? '') ? setNote(a.dir, String(a.name ?? ''), String(a.text ?? '')) : {}
  )
  ipcMain.handle('meta:setLabel', (_e, a: { dir: string; name: string; label: string | null }) =>
    path.isAbsolute(a?.dir ?? '') ? setLabel(a.dir, String(a.name ?? ''), a.label ?? null) : {}
  )
  ipcMain.handle('meta:togglePin', (_e, a: { dir: string; name: string; on?: boolean }) =>
    path.isAbsolute(a?.dir ?? '') ? togglePin(a.dir, String(a.name ?? ''), a.on) : []
  )
  ipcMain.handle('meta:labels', () => LABELS)
  ipcMain.handle('icons:themes', (_e, extra: string[]) => themeDirs(extra ?? []))
  ipcMain.handle('icons:in', (_e, dir: string) => (path.isAbsolute(dir) ? iconsIn(dir) : []))
  ipcMain.handle('fs:mkdir', (_e, dir: string, name: string) => engine.makeDir(dir, name))
  ipcMain.handle('fs:renameMany', (_e, pairs: { from: string; to: string }[]) =>
    engine.renameMany(pairs ?? [])
  )
  ipcMain.handle(
    'job:start',
    (_e, a: { kind: JobKind; sources: string[]; dest: string; opts?: JobOpts }) =>
      engine.start(a.kind, a.sources ?? [], a.dest, a.opts ?? {})
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
  ipcMain.handle('window:control', (_e, action: 'minimize' | 'maximize' | 'close') => {
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
    else win.close()
  })
  ipcMain.handle('window:isMax', () => !!win?.isMaximized())
  ipcMain.handle('window:fullscreen', (_e, on: boolean) => {
    win?.setFullScreen(!!on)
    return !!on
  })
  ipcMain.handle('window:getChrome', () => chrome)
  ipcMain.handle('window:setChrome', async (_e, next: Chrome) => {
    chrome = { customTitlebar: !!next.customTitlebar, rounded: !!next.rounded }
    await saveChrome(chrome)
    // frame/transparent cannot change on a live window: rebuild it, the UI comes back from state.json
    const old = win
    win = createWindow()
    if (old && !old.isDestroyed()) old.destroy()
    return chrome
  })
  ipcMain.handle('state:get', () => readState())
  ipcMain.handle('state:set', async (_e, s: unknown) => {
    await fs.mkdir(path.dirname(stateFile()), { recursive: true })
    await fs.writeFile(stateFile(), JSON.stringify(s, null, 2))
    return true
  })

  if (firstPath) {
    win.webContents.once('did-finish-load', () => win?.webContents.send('app:open-path', firstPath))
  }

  // SMOKE_SHOT=<file.png> renders the window once, saves a screenshot and quits; SMOKE_JS drives the UI first.
  const shot = process.env['SMOKE_SHOT']
  const js = process.env['SMOKE_JS']
  if (shot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (js && win) {
          const out = await win.webContents.executeJavaScript(js).catch((e) => 'ERR ' + e)
          if (out !== undefined) console.log('SMOKE_JS_OUT ' + JSON.stringify(out))
        }
        await new Promise((r) => setTimeout(r, 900))
        const img = await win!.webContents.capturePage()
        await fs.writeFile(shot, img.toPNG())
        console.log('SMOKE_OK ' + shot)
        app.quit()
      }, 900)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
