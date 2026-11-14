import assert from 'node:assert/strict'
import test from 'node:test'
import { dashSegments, foldSlices, sharePercent } from './chart.ts'

test('dashSegments spans the whole circle and offsets accumulate', () => {
  const segs = dashSegments([1, 1, 2], 400)
  assert.equal(segs.length, 3)
  assert.deepEqual(segs.map((s) => s.len), [100, 100, 200])
  assert.deepEqual(segs.map((s) => s.offset), [0, 100, 200])
  assert.equal(segs.reduce((sum, s) => sum + s.len, 0), 400)
})

test('dashSegments skips empty and negative values', () => {
  const segs = dashSegments([0, 5, -2, 5], 100)
  assert.deepEqual(segs.map((s) => s.len), [50, 50])
})

test('dashSegments with no data or no radius returns nothing', () => {
  assert.deepEqual(dashSegments([], 100), [])
  assert.deepEqual(dashSegments([0, 0], 100), [])
  assert.deepEqual(dashSegments([1], 0), [])
})

test('sharePercent is stable for a zero total', () => {
  assert.equal(sharePercent(5, 0), 0)
  assert.equal(sharePercent(1, 3), 33.3)
  assert.equal(sharePercent(3, 3), 100)
})

test('foldSlices folds the tail into one remainder', () => {
  const rows = [{ value: 5 }, { value: 3 }, { value: 2 }, { value: 1 }]
  assert.deepEqual(foldSlices(rows, 2), { rows: rows.slice(0, 2), rest: 3 })
  assert.deepEqual(foldSlices(rows, 10), { rows, rest: 0 })
})
