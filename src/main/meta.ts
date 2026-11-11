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
  /** name → label id, for the coloured labels the user assigns */
  labels?: Record<string, string>
  /** name → 0..5 stars */
  ratings?: Record<string, number>
  /** name → a short free-form description */
  notes?: Record<string, string>
}

/** The label palette; ids are stable because they are stored in `.mfm.json`. */
export const LABELS: { id: string; name: string; color: string }[] = [
  { id: 'red', name: 'قرمز', color: '#e0564d' },
  { id: 'orange', name: 'نارنجی', color: '#e08b39' },
  { id: 'yellow', name: 'زرد', color: '#d8b93f' },
  { id: 'green', name: 'سبز', color: '#4fb56a' },
  { id: 'blue', name: 'آبی', color: '#4f8ff0' },
  { id: 'purple', name: 'بنفش', color: '#9a6ee0' },
  { id: 'pink', name: 'صورتی', color: '#dd6b9c' },
  { id: 'gray', name: 'خاکستری', color: '#8a93a3' }
]

const LABEL_IDS = new Set(LABELS.map((l) => l.id))

const NOTE_MAX = 500

const cleanRatings = (raw: unknown): Record<string, number> => {
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [name, n] of Object.entries(raw as Record<string, unknown>)) {
    if (bare(name) && typeof n === 'number' && Number.isFinite(n)) {
      const v = Math.round(n)
      if (v >= 1 && v <= 5) out[name] = v
    }
  }
  return out
}

const cleanNotes = (raw: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [name, text] of Object.entries(raw as Record<string, unknown>)) {
    if (bare(name) && typeof text === 'string' && text.trim()) out[name] = text.slice(0, NOTE_MAX)
  }
  return out
}

const bare = (n: string) => !!n && !/[\\/]/.test(n) && n !== '.' && n !== '..' && n !== META_FILE

const cleanLabels = (raw: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [name, id] of Object.entries(raw as Record<string, unknown>)) {
    if (bare(name) && typeof id === 'string' && LABEL_IDS.has(id)) out[name] = id
  }
  return out
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
    const labels = cleanLabels(m.labels)
    if (Object.keys(labels).length) out.labels = labels
    const ratings = cleanRatings(m.ratings)
    if (Object.keys(ratings).length) out.ratings = ratings
    const notes = cleanNotes(m.notes)
    if (Object.keys(notes).length) out.notes = notes
    return out.color || out.icon || out.pins || out.labels || out.ratings || out.notes ? out : null
  } catch {
    return null
  }
}

/** One writer per folder: read-modify-write must not interleave (rating + note arrive together). */
const queues = new Map<string, Promise<unknown>>()

function serial<T>(dir: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(dir) ?? Promise.resolve()
  const next = prev.then(job, job)
  queues.set(
    dir,
    next.then(
      () => undefined,
      () => undefined
    )
  )
  return next
}

/** Merges the patch; an empty result deletes the file instead of leaving an empty marker. */
export async function setMeta(dir: string, patch: FolderMeta): Promise<FolderMeta | null> {
  return serial(dir, () => writeMeta(dir, patch))
}

async function writeMeta(dir: string, patch: FolderMeta): Promise<FolderMeta | null> {
  const cur = (await readMeta(dir)) ?? {}
  const next: FolderMeta = { ...cur, ...patch }
  if (!next.color) delete next.color
  if (!next.icon) delete next.icon
  const pins = cleanPins(next.pins)
  if (pins.length) next.pins = pins
  else delete next.pins
  const labels = cleanLabels(next.labels)
  if (Object.keys(labels).length) next.labels = labels
  else delete next.labels
  const ratings = cleanRatings(next.ratings)
  if (Object.keys(ratings).length) next.ratings = ratings
  else delete next.ratings
  const notes = cleanNotes(next.notes)
  if (Object.keys(notes).length) next.notes = notes
  else delete next.notes
  const file = path.join(dir, META_FILE)
  if (!next.color && !next.icon && !next.pins && !next.labels && !next.ratings && !next.notes) {
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

/** Sets or clears one file's label; returns the folder's label map afterwards. */
export async function setLabel(dir: string, name: string, label: string | null): Promise<Record<string, string>> {
  if (!bare(name)) return {}
  const cur = { ...((await readMeta(dir))?.labels ?? {}) }
  if (!label || !LABEL_IDS.has(label)) delete cur[name]
  else cur[name] = label
  await setMeta(dir, { labels: cur })
  return cur
}

/** Stars (0 clears) for one file; returns the folder's rating map. */
export async function setRating(dir: string, name: string, stars: number): Promise<Record<string, number>> {
  if (!bare(name)) return {}
  const cur = { ...((await readMeta(dir))?.ratings ?? {}) }
  const v = Math.round(stars)
  if (v <= 0) delete cur[name]
  else cur[name] = Math.min(5, Math.max(1, v))
  await setMeta(dir, { ratings: cur })
  return cur
}

/** Description for one file (empty clears it); returns the folder's note map. */
export async function setNote(dir: string, name: string, text: string): Promise<Record<string, string>> {
  if (!bare(name)) return {}
  const cur = { ...((await readMeta(dir))?.notes ?? {}) }
  const clean = String(text ?? '').trim().slice(0, NOTE_MAX)
  if (!clean) delete cur[name]
  else cur[name] = clean
  await setMeta(dir, { notes: cur })
  return cur
}
