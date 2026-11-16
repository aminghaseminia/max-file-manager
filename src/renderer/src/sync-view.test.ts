import test from 'node:test'
import assert from 'node:assert/strict'
import { conflictFacts, durationText, filterSyncRows, globRules, relativeSpan, ruleKey } from './sync-view.ts'
import type { SyncRow } from '../../shared/sync.ts'

const file = (size: number, mtime: number): NonNullable<SyncRow['left']> => ({ size, mtime, dir: false })
const dir = (mtime: number): NonNullable<SyncRow['left']> => ({ size: 0, mtime, dir: true })

test('filterSyncRows: all, differences and one exact state', () => {
  const rows: SyncRow[] = [
    { rel: 'a', state: 'same', left: file(1, 1), right: file(1, 1) },
    { rel: 'b', state: 'leftNewer', left: file(1, 2), right: file(1, 1) },
    { rel: 'c', state: 'conflict', left: file(1, 1), right: file(2, 1) },
    { rel: 'd', state: 'rightOnly', right: file(1, 1) }
  ]
  assert.deepEqual(filterSyncRows(rows, 'all').map((r) => r.rel), ['a', 'b', 'c', 'd'])
  assert.deepEqual(filterSyncRows(rows, 'diff').map((r) => r.rel), ['b', 'c', 'd'])
  assert.deepEqual(filterSyncRows(rows, 'conflict').map((r) => r.rel), ['c'])
  assert.deepEqual(filterSyncRows(rows, 'same').map((r) => r.rel), ['a'])
})

test('conflictFacts: newer side, size delta and the kind of each side', () => {
  const both = conflictFacts({
    rel: 'x',
    state: 'conflict',
    left: file(1000, 10_000),
    right: file(400, 10_000 + 2 * 60 * 60 * 1000)
  })
  assert.equal(both.newer, 'right')
  assert.equal(both.newerByMs, 2 * 60 * 60 * 1000)
  assert.equal(both.sizeDelta, 600)
  assert.equal(both.kind, 'file')

  const deleted = conflictFacts({ rel: 'y', state: 'conflict', left: file(10, 5) })
  assert.equal(deleted.newer, null)
  assert.equal(deleted.sizeDelta, null)
  assert.equal(deleted.kind, 'file')

  const mixed = conflictFacts({ rel: 'z', state: 'conflict', left: dir(20), right: file(3, 20) })
  assert.equal(mixed.kind, 'mixed')
  assert.equal(mixed.sizeDelta, null)

  // the same moment is not «newer» (FAT/SMB round to two seconds)
  const sameMoment = conflictFacts({ rel: 'm', state: 'conflict', left: file(10, 1000), right: file(10, 1500) })
  assert.equal(sameMoment.newer, null)
})

test('relativeSpan: monotonic buckets and never negative', () => {
  assert.deepEqual(relativeSpan(0), { value: 0, unit: 'second' })
  assert.deepEqual(relativeSpan(-45_000), { value: 45, unit: 'second' })
  assert.deepEqual(relativeSpan(90_000), { value: 2, unit: 'minute' })
  assert.deepEqual(relativeSpan(3 * 3600_000), { value: 3, unit: 'hour' })
  assert.deepEqual(relativeSpan(3 * 86400_000), { value: 3, unit: 'day' })
  assert.deepEqual(relativeSpan(90 * 86400_000), { value: 3, unit: 'month' })
  assert.deepEqual(relativeSpan(800 * 86400_000), { value: 2, unit: 'year' })
})

test('rules: stable keys and the glob-only list rsync sees', () => {
  assert.equal(ruleKey({ kind: 'size', op: 'gt', bytes: 1024 }), 'size:gt:1024')
  assert.equal(ruleKey({ kind: 'regex', value: '^x' }), 'regex:^x')
  assert.deepEqual(
    globRules([
      { kind: 'glob', value: '*.log' },
      { kind: 'regex', value: '^cache/' },
      { kind: 'glob', value: 'node_modules' },
      { kind: 'size', op: 'lt', bytes: 4 }
    ]),
    ['*.log', 'node_modules']
  )
})

test('durationText: seconds, minutes and hours without leading hour zero', () => {
  assert.equal(durationText(0), '0:00')
  assert.equal(durationText(42_000), '0:42')
  assert.equal(durationText(5 * 60_000 + 7_000), '5:07')
  assert.equal(durationText(3600_000), '1:00:00')
  assert.equal(durationText(3600_000 + 2 * 60_000 + 3_000), '1:02:03')
  assert.equal(durationText(-1000), '0:00')
})
