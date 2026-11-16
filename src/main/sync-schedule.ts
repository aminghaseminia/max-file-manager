/**
 * When a saved job is due. Pure time arithmetic so a test can pin a clock instead of waiting for a
 * minute to pass. The scheduler calls this once every 30 s; nothing here starts a timer.
 */
import type { SyncJob, SyncSchedule } from '../shared/sync.ts'

const FIELD_RE = /^[0-9*/,\-]+$/

type Field = { any: boolean; test(n: number): boolean }

/** Parse one cron field into a predicate. `allowSeven` makes Sunday both 0 and 7. */
function parseField(raw: string, min: number, max: number, allowSeven = false): Field | null {
  const value = raw.trim()
  if (!value || !FIELD_RE.test(value)) return null
  const nums = new Set<number>()
  let restricted = false
  for (const part of value.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isFinite(step) || step < 1) return null
    const range = rangePart === '*' ? [min, max] : rangePart.includes('-') ? rangePart.split('-').map(Number) : null
    if (range) {
      const [a, b] = range
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < min || b > max || a > b) return null
      if (!(rangePart === '*' && step === 1)) restricted = true
      for (let n = a; n <= b; n += step) nums.add(n)
      continue
    }
    const n = Number(rangePart)
    if (!Number.isFinite(n) || n < min || n > (allowSeven ? 7 : max)) return null
    restricted = true
    nums.add(n === 7 && allowSeven ? 0 : n)
  }
  if (!nums.size) return null
  return { any: !restricted, test: (n) => nums.has(n) }
}

export type ParsedCron = {
  minute: Field
  hour: Field
  dom: Field
  month: Field
  dow: Field
  /** both day fields restricted: classic cron ORs them, so either one matching is enough */
  eitherDay: boolean
}

export function parseCron(expr: string): ParsedCron | null {
  const fields = String(expr ?? '').trim().split(/\s+/)
  if (fields.length !== 5) return null
  const minute = parseField(fields[0], 0, 59)
  const hour = parseField(fields[1], 0, 23)
  const dom = parseField(fields[2], 1, 31)
  const month = parseField(fields[3], 1, 12)
  const dow = parseField(fields[4], 0, 6, true)
  if (!minute || !hour || !dom || !month || !dow) return null
  return { minute, hour, dom, month, dow, eitherDay: !dom.any && !dow.any }
}

export function cronMatches(expr: string, date: Date): boolean {
  const c = parseCron(expr)
  if (!c) return false
  if (!c.minute.test(date.getMinutes())) return false
  if (!c.hour.test(date.getHours())) return false
  if (!c.month.test(date.getMonth() + 1)) return false
  const dom = c.dom.test(date.getDate())
  const dow = c.dow.test(date.getDay())
  return c.eitherDay ? dom || dow : dom && dow
}

const MINUTE = 60_000

/** The first minute strictly after `from` that matches, capped so a yearly expression is not a loop. */
export function nextCronTime(expr: string, from: Date, capMinutes = 8 * 24 * 60): number | null {
  if (!parseCron(expr)) return null
  const start = new Date(from.getTime())
  start.setSeconds(0, 0)
  for (let i = 0; i <= capMinutes; i++) {
    const at = new Date(start.getTime() + i * MINUTE)
    if (cronMatches(expr, at)) return at.getTime()
  }
  return null
}

const lastMinute = (ms: number | undefined): number => (ms ? Math.floor(ms / MINUTE) : -1)

export type DueFlags = {
  /** the app just started and the job has `onStart` */
  justStarted?: boolean
}

/** Interval and cron only; mount/change are events and never make a job due by the clock. */
export function isDue(job: SyncJob, lastRunAt: number | undefined, now: number, flags: DueFlags = {}): boolean {
  if (!job.enabled) return false
  const s: SyncSchedule = job.schedule ?? {}
  if (flags.justStarted && s.onStart) return true
  const last = lastRunAt ?? 0
  if (s.everyMinutes && now - last >= s.everyMinutes * MINUTE) return true
  if (s.cron && cronMatches(s.cron, new Date(now))) {
    // a minute may only fire once, even if the 30 s tick lands twice in it
    return lastMinute(last) < Math.floor(now / MINUTE)
  }
  return false
}

/** For the sidebar: when this job would run next, or null for an event-only schedule. */
export function nextDueAt(job: SyncJob, lastRunAt: number | undefined, now: number): number | null {
  if (!job.enabled) return null
  const s = job.schedule ?? {}
  const last = lastRunAt ?? 0
  const interval = s.everyMinutes ? Math.max(now, last + s.everyMinutes * MINUTE) : null
  const cron = s.cron ? nextCronTime(s.cron, new Date(now)) : null
  if (interval && cron) return Math.min(interval, cron)
  return interval ?? cron
}

/** Human hint for the jobs list; the UI translates the key. */
export function scheduleHint(job: SyncJob): string {
  const s = job.schedule ?? {}
  const bits: string[] = []
  if (s.everyMinutes) bits.push(`${s.everyMinutes}m`)
  if (s.cron) bits.push(s.cron)
  if (s.onStart) bits.push('start')
  if (s.onMount) bits.push('mount')
  if (s.onChange) bits.push('change')
  return bits.join(' · ')
}
