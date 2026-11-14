export type Dash = { len: number; offset: number }

/**
 * A donut is drawn with `stroke-dasharray` on one circle per slice, so the only maths needed is
 * turning values into arc lengths and their running offset around the circumference.
 */
export function dashSegments(values: number[], circumference: number): Dash[] {
  const total = values.reduce((sum, v) => sum + (Number.isFinite(v) && v > 0 ? v : 0), 0)
  if (!(total > 0) || !(circumference > 0)) return []
  const out: Dash[] = []
  let offset = 0
  for (const value of values) {
    if (!Number.isFinite(value) || value <= 0) continue
    const len = (value / total) * circumference
    out.push({ len, offset })
    offset += len
  }
  return out
}

/** Share of the whole in percent, one decimal; a zero total is 0%, never NaN. */
export function sharePercent(value: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(value) || value <= 0) return 0
  return Math.round((value / total) * 1000) / 10
}

/** The trailing buckets of a long list, folded into one «other» slice. */
export function foldSlices<T extends { value: number }>(rows: T[], keep: number): { rows: T[]; rest: number } {
  if (keep < 1 || rows.length <= keep) return { rows, rest: 0 }
  return { rows: rows.slice(0, keep), rest: rows.slice(keep).reduce((sum, r) => sum + r.value, 0) }
}
