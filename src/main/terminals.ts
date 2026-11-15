import { spawn } from 'node:child_process'
import { accessSync, constants as fsConstants, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
 * «Open in terminal» with a choice of program.
 *
 * Windows has two interactive shells worth offering (PowerShell and the classic command prompt), so
 * the profile id is a shell. Linux and macOS can have several terminal emulators installed at once;
 * there the id is the emulator, and one that is not installed is simply not offered. `auto` keeps the
 * platform default and is what an older install already behaves like.
 */
export type TerminalOption = {
  id: string
  label: string
  /** the binary we start, shown as a hint in the settings row */
  detail: string
}

export type TerminalLaunch = { ok: true } | { error: string }

export type TerminalPlatform = 'win32' | 'linux' | 'darwin'

/** Windows shells, in the order the settings row lists them. */
const WIN_SHELLS: TerminalOption[] = [
  { id: 'powershell', label: 'PowerShell', detail: 'powershell.exe' },
  { id: 'cmd', label: 'Command Prompt', detail: 'cmd.exe' }
]

type LinuxTerminal = TerminalOption & { args(dir: string): string[] }

/**
 * Emulators that can start in a folder, newest and most common first. `x-terminal-emulator` is the
 * Debian alternative and needs the `cd` inside the shell, because it has no working-directory flag.
 */
const LINUX_TERMINALS: LinuxTerminal[] = [
  { id: 'konsole', label: 'Konsole', detail: 'konsole', args: (d) => ['--workdir', d] },
  { id: 'gnome-terminal', label: 'GNOME Terminal', detail: 'gnome-terminal', args: (d) => [`--working-directory=${d}`] },
  { id: 'kitty', label: 'kitty', detail: 'kitty', args: (d) => ['--directory', d] },
  { id: 'alacritty', label: 'Alacritty', detail: 'alacritty', args: (d) => ['--working-directory', d] },
  { id: 'wezterm', label: 'WezTerm', detail: 'wezterm', args: (d) => ['start', '--cwd', d] },
  { id: 'xfce4-terminal', label: 'Xfce Terminal', detail: 'xfce4-terminal', args: (d) => [`--working-directory=${d}`] },
  { id: 'mate-terminal', label: 'MATE Terminal', detail: 'mate-terminal', args: (d) => [`--working-directory=${d}`] },
  { id: 'tilix', label: 'Tilix', detail: 'tilix', args: (d) => [`--working-directory=${d}`] },
  { id: 'terminator', label: 'Terminator', detail: 'terminator', args: (d) => ['--working-directory', d] },
  { id: 'foot', label: 'foot', detail: 'foot', args: (d) => ['--working-directory', d] },
  {
    id: 'x-terminal-emulator',
    label: 'System terminal',
    detail: 'x-terminal-emulator',
    args: (d) => ['-e', 'sh', '-c', `cd ${shQuote(d)} && exec "${'$SHELL'}"`]
  }
]

/** POSIX single quotes; a quote inside the path is closed, escaped and reopened. */
export const shQuote = (p: string): string => `'${p.replace(/'/g, `'\\''`)}'`

/** A PowerShell single-quoted literal: `''` is the escaped quote, nothing else is special. */
export const psLiteral = (p: string): string => `'${p.replace(/'/g, "''")}'`

/**
 * `-EncodedCommand` is UTF-16LE base64, which is what makes PowerShell safe to start through
 * `cmd /c start`: the script contains no quote, space, `&`, `%` or `^` for either of them to
 * re-interpret, so a folder named `a & b %x%` still lands in the right place.
 */
export const psEncoded = (script: string): string => Buffer.from(script, 'utf16le').toString('base64')

/**
 * The exact command Windows should run, kept pure so the quoting rules have a test.
 *
 * `cmd` is started with `start /D <folder>` instead of `cd /d "…"`: the child gets the folder as
 * its working directory, so no path ever lands inside the child's command line. The old form
 * produced `cmd.exe /K "cd /d \"C:\a b\""` and cmd split it at the first space, which is why a
 * folder with a space (or an `&`) opened in the wrong place.
 */
export function windowsTerminalArgs(id: string, dir: string): { bin: string; args: string[] } {
  if (id === 'powershell') {
    return {
      bin: 'cmd.exe',
      args: [
        '/c',
        'start',
        '',
        'powershell.exe',
        '-NoExit',
        '-EncodedCommand',
        psEncoded(`Set-Location -LiteralPath ${psLiteral(dir)}`)
      ]
    }
  }
  return { bin: 'cmd.exe', args: ['/c', 'start', '', '/D', dir, 'cmd.exe', '/K'] }
}

/** PATH entries plus the places a desktop session usually has but a bare process may not. */
function pathDirs(): string[] {
  const dirs = (process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean)
  const extra = ['/usr/local/bin', '/usr/bin', '/bin', '/snap/bin', '/opt/homebrew/bin', '/usr/local/sbin']
  return [...new Set([...dirs, ...extra])]
}

const hasBin = (bin: string): boolean => {
  const dirs = pathDirs()
  for (const dir of dirs) {
    try {
      accessSync(path.join(dir, bin), fsConstants.X_OK)
      return true
    } catch {
      // keep looking
    }
  }
  return false
}

/** Emulators that actually exist on this machine, in the order above. */
export function linuxTerminals(has: (bin: string) => boolean = hasBin): TerminalOption[] {
  return LINUX_TERMINALS.filter((t) => has(t.detail)).map(({ id, label, detail }) => ({ id, label, detail }))
}

/** macOS always has Terminal.app; iTerm2 only when it is installed. */
export function macTerminals(exists: (p: string) => boolean = (p) => existsSyncSafe(p)): TerminalOption[] {
  const out: TerminalOption[] = [{ id: 'terminal', label: 'Terminal', detail: 'Terminal.app' }]
  if (exists('/Applications/iTerm.app')) out.push({ id: 'iterm', label: 'iTerm2', detail: 'iTerm.app' })
  return out
}

function existsSyncSafe(p: string): boolean {
  try {
    accessSync(p, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * What this machine can start. An empty list means the platform has no choice to offer (the app
 * then keeps its built-in chain), and the settings row stays hidden.
 */
export function listTerminals(
  platform: TerminalPlatform = process.platform as TerminalPlatform,
  has: (bin: string) => boolean = hasBin
): TerminalOption[] {
  if (platform === 'win32') return WIN_SHELLS
  if (platform === 'darwin') return macTerminals()
  return linuxTerminals(has)
}

/** The program `auto` means on this platform: unchanged behaviour for an existing install. */
export function autoTerminal(platform: TerminalPlatform = process.platform as TerminalPlatform): string {
  if (platform === 'win32') return 'cmd'
  if (platform === 'darwin') return 'terminal'
  return 'x-terminal-emulator'
}

/**
 * Fire and forget: a terminal stays open, so waiting for it to exit would hang the caller forever.
 * Success = the process actually spawned.
 */
const run = (cmd: string, args: string[]): Promise<TerminalLaunch> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', (e: Error) => resolve({ error: `${cmd}: ${e.message}` }))
    child.once('spawn', () => {
      child.unref()
      resolve({ ok: true })
    })
  })

const firstOk = async (candidates: [string, string[]][]): Promise<TerminalLaunch> => {
  let last = ''
  for (const [cmd, args] of candidates) {
    const r = await run(cmd, args)
    if ('ok' in r) return r
    last = r.error
  }
  return { error: last || 'ترمینالی پیدا نشد' }
}

/** Linux: the chosen emulator first, then whatever else is installed as a fallback. */
function linuxLaunch(dir: string, id: string): Promise<TerminalLaunch> {
  const available = LINUX_TERMINALS.filter((t) => t.id === id || hasBin(t.detail))
  const chosen = available.filter((t) => t.id === id)
  const ordered = [...chosen, ...available.filter((t) => t.id !== id)]
  if (!ordered.length) return Promise.resolve({ error: 'ترمینالی پیدا نشد' })
  return firstOk(ordered.map((t) => [t.detail, t.args(dir)] as [string, string[]]))
}

/**
 * Opens a terminal in `dir`. `choice` is a terminal id from `listTerminals`; `''`/`auto` keeps the
 * platform default, and an id that no longer exists falls back to the same default.
 */
export async function openTerminal(dir: string, choice = 'auto'): Promise<TerminalLaunch> {
  if (!path.isAbsolute(dir)) return { error: 'مسیر نامعتبر' }
  const st = await fs.stat(dir).catch(() => null)
  if (!st || !st.isDirectory()) return { error: 'پوشه نیست' }
  const id = !choice || choice === 'auto' ? autoTerminal() : choice

  if (process.platform === 'win32') {
    const shell = id === 'powershell' ? 'powershell' : 'cmd'
    const { bin, args } = windowsTerminalArgs(shell, dir)
    return run(bin, args)
  }
  if (process.platform === 'darwin') {
    return run('open', ['-a', id === 'iterm' ? 'iTerm' : 'Terminal', dir])
  }
  return linuxLaunch(dir, id)
}
