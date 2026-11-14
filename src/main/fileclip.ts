/**
 * File list on the system clipboard.
 * On Wayland, standard unfocused processes cannot write the clipboard via wl_data_device.
 * We use a dedicated helper (wayland-clip) utilizing ext-data-control / wlr-data-control,
 * which owns the selection with text/uri-list, x-special/gnome-copied-files, and
 * application/x-kde-cutselection. On X11, a detached PySide fallback owns the selection.
 * The helper stays alive and receives new paths over stdin.
 * Its pid is kept per profile so a new app run can retire a stale owner.
 * If neither helper is available, the paths go to the clipboard as plain text.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, clipboard } from 'electron'

const SCRIPT = String.raw`
import sys, json, select
from PySide6.QtCore import QMimeData, QTimer, QUrl
from PySide6.QtWidgets import QApplication
app = QApplication([])
cb = app.clipboard()
def apply(msg):
    if msg.get('clear'):
        cb.clear()
        return
    paths = [p for p in (msg.get('paths') or []) if p]
    urls = [QUrl.fromLocalFile(p) for p in paths]
    md = QMimeData()
    md.setUrls(urls)
    if urls:
        cut = bool(msg.get('cut'))
        md.setData('x-special/gnome-copied-files', (('cut' if cut else 'copy') + '\n' + '\n'.join(u.toString() for u in urls)).encode())
        md.setData('application/x-kde-cutselection', b'1' if cut else b'0')
    cb.setMimeData(md)
def poll():
    while select.select([sys.stdin], [], [], 0)[0]:
        line = sys.stdin.readline()
        if not line:
            return  # the app went away; keep owning the selection until the timer fires
        try:
            apply(json.loads(line))
            print('ok', flush=True)
        except Exception as e:
            print('err', str(e), flush=True)
t = QTimer()
t.timeout.connect(poll)
t.start(40)
print('ready', flush=True)
QTimer.singleShot(600000, app.quit)
app.exec()
`

let child: ChildProcess | null = null
let starting: Promise<boolean> | null = null
let ack: (() => void) | null = null
let out = ''

const ownerFile = () => path.join(app.getPath('userData'), 'clipboard-owner')

const isOurHelper = (pid: number): boolean => {
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
    return cmd.includes('wayland-clip') || cmd.includes('PySide6')
  } catch {
    return false
  }
}

function findWaylandBinary(): string | null {
  const candidates = [
    path.join(__dirname, 'wayland-clip'),
    path.join(__dirname, 'wayland-clip', 'wayland-clip'),
    path.join(app.getAppPath(), 'out', 'main', 'wayland-clip'),
    path.join(app.getAppPath(), 'src', 'main', 'wayland-clip', 'wayland-clip')
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

/** Retire an owner left by an earlier run (the pid file is per profile). */
function killOwner(): void {
  try {
    const pid = Number(readFileSync(ownerFile(), 'utf8'))
    if (Number.isInteger(pid) && pid > 0 && isOurHelper(pid)) process.kill(pid, 'SIGTERM')
  } catch {
    // no live owner
  }
  try {
    rmSync(ownerFile(), { force: true })
  } catch {
    // ignore
  }
}

function startHelper(): Promise<boolean> {
  if (child) return Promise.resolve(true)
  if (starting) return starting
  starting = new Promise<boolean>((resolve) => {
    let proc: ChildProcess | null = null
    const waylandBin = process.env.WAYLAND_DISPLAY ? findWaylandBinary() : null

    if (waylandBin) {
      try {
        proc = spawn(waylandBin, [], {
          detached: true,
          stdio: ['pipe', 'pipe', 'ignore']
        })
      } catch {
        proc = null
      }
    }

    if (!proc) {
      try {
        proc = spawn('python3', ['-c', SCRIPT], {
          detached: true,
          stdio: ['pipe', 'pipe', 'ignore']
        })
      } catch {
        starting = null
        resolve(false)
        return
      }
    }

    child = proc
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      starting = null
      resolve(ok)
    }

    proc.stdout?.on('data', (buf: Buffer) => {
      out += String(buf)
      for (;;) {
        const nl = out.indexOf('\n')
        if (nl < 0) break
        const line = out.slice(0, nl).trim()
        out = out.slice(nl + 1)
        if (line === 'ready') {
          try {
            writeFileSync(ownerFile(), String(proc?.pid ?? ''))
          } catch {
            // the clipboard works without the pid file
          }
          done(true)
        } else if (line === 'ok' || line === 'err') {
          ack?.()
          ack = null
        }
      }
    })

    proc.once('error', () => {
      child = null
      done(false)
    })
    proc.once('exit', () => {
      child = null
      done(false)
    })
    setTimeout(() => done(true), 4000)
  })
  return starting
}

async function send(msg: Record<string, unknown>): Promise<boolean> {
  if (!child) {
    killOwner()
    if (!(await startHelper()) || !child) return false
  }
  const proc = child
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      ack = null
      resolve(ok)
    }
    ack = () => finish(true)
    try {
      proc.stdin?.write(JSON.stringify(msg) + '\n')
    } catch {
      finish(false)
      return
    }
    setTimeout(() => finish(false), 5000)
  })
}

/** Resolves to `files` only after the helper confirms that the selection is set. */
export async function copyFilesToClipboard(paths: string[], cut = false): Promise<'files' | 'text'> {
  const list = paths.filter((p) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p))
  if (!list.length) return 'text'
  if (await send({ paths: list, cut })) return 'files'
  clipboard.writeText(list.join('\n'))
  return 'text'
}

/** Clear a file-list selection before the renderer writes an image (the helper stays alive). */
export function releaseFileClipboard(): void {
  if (child) {
    try {
      child.stdin?.write(JSON.stringify({ clear: true }) + '\n')
    } catch {
      // ignore
    }
  } else {
    killOwner()
  }
}

export function stopFileClipboard(): void {
  child?.kill()
  child = null
}
