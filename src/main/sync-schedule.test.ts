import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanSyncJob } from '../shared/sync.ts'
import { cronMatches, isDue, nextCronTime, nextDueAt, parseCron, scheduleHint } from './sync-schedule.ts'

const job = (schedule: Record<string, unknown>) =>
  cleanSyncJob({
    id: 'job-1',
    name: 'backup',
    left: '/tmp/a',
    right: '/tmp/b',
    direction: 'ltr',
    compareBy: 'mtime',
    enabled: true,
    schedule
  })!

test('parseCron: ranges, lists, steps and the Sunday alias', () => {
  assert.ok(parseCron('*/15 9-17 * * 1-5'))
  assert.ok(parseCron('0 3 1,15 * *'))
  assert.ok(parseCron('5 0 * * 7'))
  assert.equal(parseCron('60 * * * *'), null)
  assert.equal(parseCron('* * * *'), null)
  assert.equal(parseCron('* * * * *; rm -rf /'), null)
  const sunday = parseCron('0 0 * * 7')
  assert.ok(sunday)
  assert.equal(cronMatches('0 0 * * 7', new Date(2026, 10, 15, 0, 0)), true) // Sunday
})

test('cronMatches: minute and hour are respected', () => {
  const at = new Date(2026, 4, 4, 14, 30)
  assert.equal(cronMatches('30 14 * * *', at), true)
  assert.equal(cronMatches('31 14 * * *', at), false)
  assert.equal(cronMatches('30 15 * * *', at), false)
  assert.equal(cronMatches('*/10 * * * *', at), true)
  assert.equal(cronMatches('*/7 * * * *', at), false)
})

test('cronMatches: when both day fields are restricted, classic cron ORs them', () => {
  // 1st of the month OR a Monday
  const monday = new Date(2026, 10, 16, 3, 0) // Monday, not the 1st
  const first = new Date(2026, 10, 1, 3, 0) // Sunday the 1st
  assert.equal(monday.getDay(), 1)
  assert.equal(cronMatches('0 3 1 * 1', monday), true)
  assert.equal(cronMatches('0 3 1 * 1', first), true)
  assert.equal(cronMatches('0 3 1 * 2', monday), false)
})

test('nextCronTime: finds the next matching minute, null for nonsense', () => {
  const from = new Date(2026, 0, 1, 10, 7)
  const next = nextCronTime('*/15 * * * *', from)
  assert.equal(new Date(next!).getMinutes(), 15)
  assert.equal(nextCronTime('nope', from), null)
})

test('isDue: interval, once per minute for cron, and disabled jobs never run', () => {
  const now = new Date(2026, 5, 1, 12, 0, 10).getTime()
  const every = job({ everyMinutes: 30 })
  assert.equal(isDue(every, now - 31 * 60_000, now), true)
  assert.equal(isDue(every, now - 29 * 60_000, now), false)
  const cron = job({ cron: '0 12 * * *' })
  assert.equal(isDue(cron, undefined, now), true)
  assert.equal(isDue(cron, now - 5_000, now), false, 'the same minute must not fire twice')
  assert.equal(isDue(cron, now - 24 * 60 * 60_000, now), true)
  const disabled = cleanSyncJob({
    id: 'job-2',
    left: '/tmp/a',
    right: '/tmp/b',
    enabled: false,
    schedule: { everyMinutes: 1 }
  })!
  assert.equal(isDue(disabled, undefined, now), false)
  const start = job({ onStart: true })
  assert.equal(isDue(start, now - 1000, now), false)
  assert.equal(isDue(start, now - 1000, now, { justStarted: true }), true)
})

test('nextDueAt: the earlier of interval and cron; pure events have no clock time', () => {
  const now = new Date(2026, 5, 1, 12, 0, 0).getTime()
  assert.equal(nextDueAt(job({ everyMinutes: 10 }), now - 60_000, now), now + 9 * 60_000)
  assert.equal(nextDueAt(job({ onMount: true, onChange: true }), now, now), null)
  const both = nextDueAt(job({ everyMinutes: 60, cron: '30 12 * * *' }), now, now)
  assert.equal(both, new Date(2026, 5, 1, 12, 30).getTime())
})

test('scheduleHint lists every trigger', () => {
  assert.equal(scheduleHint(job({ everyMinutes: 15, onStart: true })), '15m · start')
  assert.equal(scheduleHint(job({ cron: '0 3 * * *', onMount: true })), '0 3 * * * · mount')
})
