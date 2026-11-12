/**
 * File list on the system clipboard. Electron 45's clipboard cannot write `text/uri-list`, so a
 * small detached PySide process owns the selection with `QMimeData.setUrls`. It is detached and
 * lives for ten minutes: Wayland transfers the clipboard on demand, so the owner must outlive the
 * copy (and even the app). The fallback is the paths as plain text.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { clipboard } from 'electron'

const SCRIPT = String.raw`
import sys
from PySide6.QtCore import QMimeData, QTimer, QUrl
from PySide6.QtWidgets import QApplication
args = sys.argv[1:]
cut = '--cut' in args
paths = [p for p in args if p != '--cut']
urls = [QUrl.fromLocalFile(p) for p in paths if p]
app = QApplication([])
md = QMimeData()
md.setUrls(urls)
if urls:
    md.setData('x-special/gnome-copied-files', (('cut' if cut else 'copy') + '\n' + '\n'.join(u.toString() for u in urls)).encode())
    md.setData('application/x-kde-cutselection', b'1' if cut else b'0')
app.clipboard().setMimeData(md)
QTimer.singleShot(600000, app.quit)
app.exec()
`

let child: ChildProcess | null = null

/** Replaces the previous owner so the newest copy is the one every app pastes. */
export function copyFilesToClipboard(paths: string[], cut = false): Promise<'files' | 'text'> {
  const list = paths.filter((p) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p))
  if (!list.length) return Promise.resolve('text')
  child?.kill()
  child = null
  try {
    child = spawn('python3', ['-c', SCRIPT, ...(cut ? ['--cut'] : []), ...list], {
      detached: true,
      stdio: 'ignore'
    })
  } catch {
    clipboard.writeText(list.join('\n'))
    return Promise.resolve('text')
  }
  const proc = child
  return new Promise((resolve) => {
    let done = false
    const finish = (kind: 'files' | 'text') => {
      if (done) return
      done = true
      resolve(kind)
    }
    proc.once('spawn', () => {
      proc.unref()
      finish('files')
    })
    proc.once('error', () => {
      clipboard.writeText(list.join('\n'))
      finish('text')
    })
    setTimeout(() => finish(proc.pid ? 'files' : 'text'), 800)
  })
}

/** The owner is detached on purpose; only a new copy (or its ten-minute timeout) replaces it. */
export function stopFileClipboard(): void {
  child = null
}
