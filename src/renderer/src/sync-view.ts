/**
 * Pure view maths for the sync workspace: status filtering, conflict facts and the human span the
 * conflict cards show. No React and no `t()` here, so the numbers can be tested without a browser.
 */
import type { SyncIgnoreRule, SyncRow, SyncState } from '../../shared/sync.ts'

export type StatusFilter = 'all' | 'diff' | SyncState

export const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'diff',
  'same',
  'leftOnly',
  'rightOnly',
  'leftNewer',
  'rightNewer',
  'sizeDiff',
  'contentDiff',
  'typeDiff',
  'conflict'
]

export function filterSyncRows(rows: SyncRow[], filter: StatusFilter): SyncRow[] {
  if (filter === 'all') return rows
  if (filter === 'diff') return rows.filter((r) => r.state !== 'same')
  return rows.filter((r) => r.state === filter)
}

export type SideKind = 'file' | 'dir' | 'mixed' | null

export type ConflictFacts = {
  /** which side has the newer mtime; null when one side is missing or the timestamps agree */
  newer: 'left' | 'right' | null
  newerByMs: number
  /** left size − right size; null unless both sides are files */
  sizeDelta: number | null
  kind: SideKind
}

/** The two-second window matches `SAME_MTIME_MS` in the planner. */
const SAME_MTIME_MS = 2000

export function conflictFacts(row: SyncRow): ConflictFacts {
  const l = row.left
  const r = row.right
  const kind: SideKind = l && r ? (l.dir !== r.dir ? 'mixed' : l.dir ? 'dir' : 'file') : l ? (l.dir ? 'dir' : 'file') : r ? (r.dir ? 'dir' : 'file') : null
  let newer: 'left' | 'right' | null = null
  let newerByMs = 0
  if (l && r) {
    const d = l.mtime - r.mtime
    if (Math.abs(d) > SAME_MTIME_MS) {
      newer = d > 0 ? 'left' : 'right'
      newerByMs = Math.abs(d)
    }
  }
  const sizeDelta = l && r && !l.dir && !r.dir ? l.size - r.size : null
  return { newer, newerByMs, sizeDelta, kind }
}

export type SpanUnit = 'second' | 'minute' | 'hour' | 'day' | 'month' | 'year'
export type Span = { value: number; unit: SpanUnit }

/** Coarse, monotonic buckets: enough to say «۲ ساعت جدیدتر» without a date library. */
export function relativeSpan(ms: number): Span {
  const s = Math.max(0, Math.round(Math.abs(ms) / 1000))
  if (s < 60) return { value: s, unit: 'second' }
  const m = Math.round(s / 60)
  if (m < 60) return { value: m, unit: 'minute' }
  const h = Math.round(m / 60)
  if (h < 24) return { value: h, unit: 'hour' }
  const d = Math.round(h / 24)
  if (d < 30) return { value: d, unit: 'day' }
  const mo = Math.round(d / 30)
  if (mo < 12) return { value: mo, unit: 'month' }
  return { value: Math.round(mo / 12), unit: 'year' }
}

export const ruleKey = (rule: SyncIgnoreRule): string =>
  rule.kind === 'size' ? `size:${rule.op}:${rule.bytes}` : `${rule.kind}:${rule.value}`

/** Glob values feed the legacy `ignore` list that rsync consumes. */
export const globRules = (rules: SyncIgnoreRule[]): string[] =>
  rules.flatMap((r) => (r.kind === 'glob' ? [r.value] : []))
