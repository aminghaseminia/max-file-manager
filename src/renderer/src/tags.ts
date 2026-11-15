import type { Id3Fields } from './api'

/** Shared fields shown in the tag editor, in the order they appear there. */
export const TAG_FIELDS = [
  'title',
  'artist',
  'albumArtist',
  'album',
  'year',
  'genre',
  'composer',
  'disc',
  'discTotal',
  'comment'
] as const

/** Numbers that only make sense for one file are shown in the shared section when n === 1. */
export const TAG_SINGLE_FIELDS = ['track', 'trackTotal'] as const

export type TagFieldKey = keyof Id3Fields

/**
 * One value for a set of per-file values; anything that differs becomes an empty, "mixed" field
 * (the editor then leaves it alone until the user types something).
 */
export function commonValues(values: string[]): { value: string; mixed: boolean } {
  if (!values.length) return { value: '', mixed: false }
  const first = values[0] ?? ''
  for (let i = 1; i < values.length; i++) if ((values[i] ?? '') !== first) return { value: '', mixed: true }
  return { value: first, mixed: false }
}

/** 1, 2, 3… for the current order; never negative and never fractional. */
export function autoTracks(count: number, start = 1): string[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
  const from = Number.isFinite(start) ? Math.trunc(start) : 1
  return Array.from({ length: n }, (_, i) => String(from + i))
}

export type TagPlanInput = {
  files: { path: string; fields: Id3Fields }[]
  /** current shared-field values in the dialog */
  common: Id3Fields
  /** keys the user actually touched */
  dirty: string[]
  /** per-file edits (title/track) — they always win over the shared value */
  rows: Record<string, { title?: string; track?: string }>
}

/**
 * Turns the dialog into the exact write request: a shared field reaches every file only when it is
 * dirty (an empty string clears the frame), one selected file writes every dialog field, and each
 * file's own row overrides the shared title/track. Values identical to the current file are
 * dropped, so a file that changed nothing arrives with `fields: {}` and is a no-op on disk.
 */
export function tagPlan(input: TagPlanInput): { path: string; fields: Id3Fields }[] {
  const single = input.files.length === 1
  const dirty = new Set(input.dirty)
  const keys: TagFieldKey[] = single
    ? [...TAG_FIELDS, ...TAG_SINGLE_FIELDS]
    : TAG_FIELDS.filter((key) => dirty.has(key))
  return input.files.map((file) => {
    const fields: Id3Fields = {}
    for (const key of keys) {
      const value = input.common[key] !== undefined ? String(input.common[key]) : (file.fields[key] ?? '')
      fields[key] = value
    }
    const row = input.rows[file.path]
    if (row?.title !== undefined) fields.title = row.title
    if (row?.track !== undefined) fields.track = row.track
    for (const key of Object.keys(fields) as TagFieldKey[]) {
      if ((fields[key] ?? '') === (file.fields[key] ?? '')) delete fields[key]
    }
    return { path: file.path, fields }
  })
}
