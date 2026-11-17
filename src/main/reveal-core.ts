/**
 * Which program opens the desktop's own file manager with one file selected.
 *
 * Electron's `shell.showItemInFolder` asks `org.freedesktop.FileManager1`, which on a Linux desktop
 * regularly ends up merely opening the folder (and on an install where this app registered itself as
 * that bus name, the request comes back to this app) — the file is never focused. Dolphin, Nautilus,
 * Nemo and Caja all take `--select <path>`, so the file manager is started directly instead.
 */
const SELECTERS = ['dolphin', 'nautilus', 'nemo', 'caja'] as const

/** The manager a desktop session actually ships, so a machine with two of them opens the right one. */
const BY_DESKTOP: [RegExp, string][] = [
  [/kde|plasma/i, 'dolphin'],
  [/cinnamon/i, 'nemo'],
  [/mate/i, 'caja'],
  [/gnome|unity|pantheon|budgie/i, 'nautilus']
]

/** The command that reveals `file`, or null when no known file manager is installed. */
export function selectCommand(
  file: string,
  desktop: string,
  has: (bin: string) => boolean
): { cmd: string; args: string[] } | null {
  const preferred = BY_DESKTOP.find(([re]) => re.test(desktop))?.[1]
  const order = preferred
    ? [preferred, ...SELECTERS.filter((b) => b !== preferred)]
    : [...SELECTERS]
  const cmd = order.find((b) => has(b))
  return cmd ? { cmd, args: ['--select', file] } : null
}
