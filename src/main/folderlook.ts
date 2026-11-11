import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveIconName } from './icons.ts'

/**
 * Folder looks other file managers already wrote on disk: KDE's `.directory` (Dolphin) and
 * Windows' `desktop.ini`. Read-only — we never write into them, `.mfm.json` stays our own file.
 */

const exists = (p: string) => fs.access(p).then(() => true, () => false)

/** `Icon=` from a KDE desktop file; the last one wins, as the spec says. */
export function parseDirectoryIcon(text: string): string {
  let icon = ''
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*Icon\s*=\s*(.+?)\s*$/.exec(line)
    if (m) icon = m[1]
  }
  return icon
}

/** `IconResource=C:\x\i.ico,0` or `IconFile=…` (+ optional IconIndex) from desktop.ini. */
export function parseDesktopIniIcon(text: string): string {
  let file = ''
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const res = /^\s*IconResource\s*=\s*(.+?)\s*$/.exec(line)
    if (res && res[1]) file = res[1]
    const raw = /^\s*IconFile\s*=\s*(.+?)\s*$/.exec(line)
    if (raw && raw[1]) file = raw[1]
  }
  // the resource form carries the icon index: path,0 — and the value may be quoted
  return file.replace(/,\s*-?\d+$/, '').replace(/^"|"$/g, '').trim()
}

/** Absolute, or a file sitting next to the desktop.ini (that is what a copied folder has). */
async function anyPath(dir: string, p: string): Promise<string | null> {
  if (!p) return null
  if (path.isAbsolute(p) && (await exists(p))) return p
  const local = path.join(dir, p)
  return (await exists(local)) ? local : null
}

/** The icon another desktop already assigned to this folder, as a file we can display. */
export async function readNativeFolderLook(dir: string): Promise<{ icon?: string }> {
  const kde = parseDirectoryIcon(await fs.readFile(path.join(dir, '.directory'), 'utf8').catch(() => ''))
  if (kde) {
    const file = await resolveIconName(kde)
    if (file) return { icon: file }
  }
  const win = parseDesktopIniIcon(await fs.readFile(path.join(dir, 'desktop.ini'), 'utf8').catch(() => ''))
  if (win) {
    const file = await anyPath(dir, win)
    if (file) return { icon: file }
  }
  return {}
}
