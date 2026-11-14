/**
 * Win+E takeover on Windows.
 *
 * Windows resolves Win+E inside explorer.exe, and it cannot be claimed through RegisterHotKey —
 * Electron's `globalShortcut.register('Super+E')` simply returns false. The only remaining route is
 * a low-level keyboard hook, which is exactly what Directory Opus installs for its "Launching Opus
 * from the Win+E hotkey" feature. `WinEHook.exe` (built from `wine-hook/WinEHook.cs`) owns that hook,
 * swallows the keystroke and starts this app; a running instance raises its window instead of
 * opening a second one.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export type Takeover = { ok: boolean; active: boolean; app: string; error?: string }

let child: ChildProcess | null = null
/** the helper is meant to outlive the app, so quitting must not kill it */
let keepAlive = false

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const RUN_VALUE = 'MaxFileManagerWinE'

const noApp = (error: string): Takeover => ({ ok: false, active: false, app: '', error })

/** dev: out/main next to the bundle · packaged: resources/ (extraResources in electron-builder.yml) */
function helperPath(): string | null {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'WinEHook.exe'),
    path.join(__dirname, 'WinEHook.exe'),
    path.join(app.getAppPath(), 'out', 'main', 'WinEHook.exe')
  ]
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return null
}

/**
 * The app a Win+E press should open. Packaged this is the exe itself (a second launch hits the
 * single-instance lock and raises the window); in `electron-vite dev` it is electron + the app path.
 */
function launchTarget(): { exe: string; args: string } {
  if (app.isPackaged) return { exe: process.execPath, args: '' }
  return { exe: process.execPath, args: `"${app.getAppPath()}"` }
}

export function winETakeoverStatus(): Takeover {
  const helper = helperPath()
  return {
    ok: !!helper,
    active: !!child,
    app: launchTarget().exe,
    error: helper ? undefined : 'WinEHook.exe is missing (npm run build compiles it)'
  }
}

/** The command Windows runs at sign-in so Win+E keeps working while the app is closed. */
function autostartCommand(helper: string): string {
  const target = launchTarget()
  return `"${helper}" --target "${target.exe}"${target.args ? ` --args ${target.args}` : ''}`
}

const writeAutostart = (helper: string, on: boolean): void => {
  try {
    if (on) {
      execFileSync(
        'reg.exe',
        ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', autostartCommand(helper), '/f'],
        { timeout: 5000, windowsHide: true }
      )
    } else {
      execFileSync('reg.exe', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f'], {
        timeout: 5000,
        windowsHide: true
      })
    }
  } catch {
    // deleting a value that is not there is not an error
  }
}

/** Stop every helper, including one started at sign-in (the app owns that binary). */
const retireHelpers = (): void => {
  const proc = child
  child = null
  keepAlive = false
  try {
    proc?.kill()
  } catch {
    // already gone
  }
  try {
    execFileSync('taskkill.exe', ['/IM', 'WinEHook.exe', '/F'], { timeout: 5000, windowsHide: true })
  } catch {
    // no helper was running
  }
}

/**
 * Idempotent: on = make sure the hook runs, off = retire it. Never throws.
 * `autostart` keeps a helper alive after the app quits and re-launches it at sign-in.
 */
export function winETakeover(enabled: boolean, autostart = false): Takeover {
  if (process.platform !== 'win32') return noApp('Windows only')
  if (!enabled) {
    retireHelpers()
    const helper = helperPath()
    if (helper) writeAutostart(helper, false)
    return { ok: true, active: false, app: '' }
  }
  const helper = helperPath()
  if (!helper) return noApp('WinEHook.exe is missing (npm run build compiles it)')
  writeAutostart(helper, autostart)
  keepAlive = autostart
  if (child) return { ok: true, active: true, app: launchTarget().exe }
  const target = launchTarget()
  try {
    const args = ['--target', target.exe, '--args', target.args]
    // a sign-in helper has no parent: it must survive the app closing (and quitting must not kill it)
    if (!autostart) args.push('--parent', String(process.pid))
    const proc = spawn(helper, args, { detached: true, stdio: 'ignore', windowsHide: true })
    proc.once('error', () => {
      if (child === proc) child = null
    })
    proc.once('exit', () => {
      if (child === proc) child = null
    })
    proc.unref()
    child = proc
    return { ok: true, active: true, app: target.exe }
  } catch (e) {
    return noApp(e instanceof Error ? e.message : String(e))
  }
}

/** Called when the app quits: a keep-alive helper stays, an app-owned one goes with it. */
export function stopWinETakeover(): void {
  if (keepAlive) {
    child = null
    return
  }
  const proc = child
  child = null
  if (!proc) return
  try {
    proc.kill()
  } catch {
    // it may have exited with the parent already
  }
}
