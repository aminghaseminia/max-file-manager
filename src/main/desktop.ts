import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { nativeImage, shell, type WebContents } from 'electron'

/**
 * Fire and forget: a terminal stays open, so waiting for it to exit would hang the caller forever.
 * Success = the process actually spawned.
 */
const run = (cmd: string, args: string[]): Promise<{ ok: true } | { error: string }> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', (e: Error) => resolve({ error: `${cmd}: ${e.message}` }))
    child.once('spawn', () => {
      child.unref()
      resolve({ ok: true })
    })
  })

const firstOk = async (candidates: [string, string[]][]): Promise<{ ok: true } | { error: string }> => {
  let last = ''
  for (const [cmd, args] of candidates) {
    const r = await run(cmd, args)
    if ('ok' in r) return r
    last = r.error
  }
  return { error: last || 'ترمینالی پیدا نشد' }
}

/** Opens a terminal in `dir`; the first terminal that exists wins. */
export async function openTerminal(dir: string): Promise<{ ok: true } | { error: string }> {
  if (!path.isAbsolute(dir)) return { error: 'مسیر نامعتبر' }
  const st = await fs.stat(dir).catch(() => null)
  if (!st || !st.isDirectory()) return { error: 'پوشه نیست' }
  if (process.platform === 'win32') {
    return run('cmd', ['/c', 'start', 'cmd', '/K', `cd /d "${dir}"`])
  }
  if (process.platform === 'darwin') {
    return run('open', ['-a', 'Terminal', dir])
  }
  return firstOk([
    ['konsole', ['--workdir', dir]],
    ['gnome-terminal', [`--working-directory=${dir}`]],
    ['xfce4-terminal', [`--working-directory=${dir}`]],
    ['x-terminal-emulator', ['-e', 'bash', '-l']]
  ])
}

/** Shows the file inside the system's own file manager. */
export function revealFile(p: string): { ok: true } | { error: string } {
  if (!path.isAbsolute(p)) return { error: 'مسیر نامعتبر' }
  shell.showItemInFolder(p)
  return { ok: true }
}

let dragIcon: Electron.NativeImage | null = null

/**
 * Starts a real OS drag so the file can be dropped into Dolphin, a chat window, an upload field…
 * Called from `ipcRenderer.send` during `dragstart`.
 */
export async function startFileDrag(wc: WebContents, files: string[]): Promise<{ ok: true } | { error: string }> {
  if (wc.isDestroyed()) return { error: 'پنجره بسته شده' }
  const list = files.filter((f) => path.isAbsolute(f))
  if (!list.length) return { error: 'مسیر نامعتبر' }
  if (!dragIcon) {
    // a 32×32 dot is enough: the target app draws the file, the cursor only needs an image
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAMklEQVR4nOzOMQ0AMAgAMLLMJAbRgiuQwdMq6J/KjkMvjgkICAgICAgICAgICAgICCwAAAD//1rIWFMAAAAGSURBVAMA+XwDCUIWSBAAAAAASUVORK5CYII=',
      'base64'
    )
    dragIcon = nativeImage.createFromBuffer(png)
  }
  // `file` is required by Electron; `files` carries a multi-selection. Passing only `files`
  // is rejected by the type and by the runtime.
  try {
    wc.startDrag({ file: list[0], files: list, icon: dragIcon })
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
