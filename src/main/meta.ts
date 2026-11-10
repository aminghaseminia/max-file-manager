import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Per-folder look stored *inside* the folder, so it travels with it and needs no OS support. */
export const META_FILE = '.mfm.json'

export type FolderMeta = {
  /** CSS colour for the folder glyph */
  color?: string
  /** absolute path to an .svg/.png icon, or `g:<name>` for a built-in glyph */
  icon?: string
}

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
    return out.color || out.icon ? out : null
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
  const file = path.join(dir, META_FILE)
  if (!next.color && !next.icon) {
    await fs.rm(file, { force: true })
    return null
  }
  await fs.writeFile(file, JSON.stringify(next, null, 2))
  return next
}
