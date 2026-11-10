import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Per-folder look stored *inside* the folder, so it travels with it and needs no OS support. */
export const META_FILE = '.mfm.json'

export type FolderMeta = {
  /** CSS colour for the folder glyph */
  color?: string
  /** absolute path to an .svg/.png icon, or `g:<name>` for a built-in glyph */
  icon?: string
  /** file names pinned to the top of this folder's listing */
  pins?: string[]
}

/** A pin is a bare name inside the folder: no separators, no traversal, capped list. */
const cleanPins = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? raw
        .filter((n): n is string => typeof n === 'string' && !!n && !/[\\/]/.test(n) && n !== '.' && n !== '..' && n !== META_FILE)
        .slice(0, 200)
    : []

const MAX_META = 4096

export async function readMeta(dir: string): Promise<FolderMeta | null> {
  const raw = await fs.readFile(path.join(dir, META_FILE), 'utf8').catch(() => '')
  if (!raw || raw.length > MAX_META) return null
  try {
    const m = JSON.parse(raw)
    if (!m || typeof m !== 'object') return null
    const out: FolderMeta = {}
    if (typeof m.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(m.color)) out.color = m.color
    if (typeof m.icon === 'string' && (m.icon.startsWith('g:') || path.isAbsolute(m.icon))) {
      out.icon = m.icon
    }
    const pins = cleanPins(m.pins)
    if (pins.length) out.pins = pins
    return out.color || out.icon || out.pins ? out : null
  } catch {
    return null
  }
}

/** Merges the patch; an empty result deletes the file instead of leaving an empty marker. */
export async function setMeta(dir: string, patch: FolderMeta): Promise<FolderMeta | null> {
  const cur = (await readMeta(dir)) ?? {}
  const next: FolderMeta = { ...cur, ...patch }
  if (!next.color) delete next.color
  if (!next.icon) delete next.icon
  const pins = cleanPins(next.pins)
  if (pins.length) next.pins = pins
  else delete next.pins
  const file = path.join(dir, META_FILE)
  if (!next.color && !next.icon && !next.pins) {
    await fs.rm(file, { force: true })
    return null
  }
  await fs.writeFile(file, JSON.stringify(next, null, 2))
  return next
}

/** Adds or removes one name; returns the folder's pins after the change. */
export async function togglePin(dir: string, name: string, on?: boolean): Promise<string[]> {
  if (!name || /[\\/]/.test(name) || name === '..' ) return []
  const cur = (await readMeta(dir))?.pins ?? []
  const has = cur.includes(name)
  const want = on ?? !has
  const next = want ? (has ? cur : [...cur, name]) : cur.filter((n) => n !== name)
  await setMeta(dir, { pins: next })
  return next
}
