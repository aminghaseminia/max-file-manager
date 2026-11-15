import { spawn } from 'node:child_process'
import path from 'node:path'
import { nativeImage, shell, type WebContents } from 'electron'

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

/**
 * Executes a custom command in the background with %f substituted by the quoted file/folder path.
 * Detached and unreferenced so GUI apps and background jobs run independently.
 */
export async function runCustomCommand(
  cmdTemplate: string,
  targetPath: string
): Promise<{ ok: true } | { error: string }> {
  const cmd = String(cmdTemplate ?? '').trim()
  if (!cmd) return { error: 'دستوری تعریف نشده' }
  if (!path.isAbsolute(targetPath)) return { error: 'مسیر نامعتبر' }

  const isWin = process.platform === 'win32'
  const quote = (p: string) => (isWin ? `"${p.replace(/"/g, '""')}"` : `'${p.replace(/'/g, `'\\''`)}'`)
  const quoted = quote(targetPath)
  const dir = path.dirname(targetPath)
  const quotedDir = quote(dir)

  let line = cmd
  if (line.includes('%f') || line.includes('{path}')) {
    line = line.replace(/%f|\{path\}/g, quoted)
  } else {
    line = `${line} ${quoted}`
  }
  line = line.replace(/%d|\{dir\}/g, quotedDir)

  return new Promise((resolve) => {
    try {
      const child = isWin
        ? spawn('cmd.exe', ['/c', line], {
            cwd: dir,
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          })
        : spawn('sh', ['-c', line], {
            cwd: dir,
            detached: true,
            stdio: 'ignore'
          })
      child.once('error', (e: Error) => resolve({ error: e.message }))
      child.once('spawn', () => {
        child.unref()
        resolve({ ok: true })
      })
    } catch (e) {
      resolve({ error: e instanceof Error ? e.message : String(e) })
    }
  })
}
