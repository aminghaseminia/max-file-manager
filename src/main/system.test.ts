import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMacSwap, parseMeminfo } from './system.ts'

test('parseMeminfo: uses MemAvailable and reports swap bytes', () => {
  const info = parseMeminfo([
    'MemTotal:       16000000 kB',
    'MemFree:         2000000 kB',
    'MemAvailable:    9000000 kB',
    'Buffers:          100000 kB',
    'Cached:          3000000 kB',
    'SwapTotal:       4000000 kB',
    'SwapFree:        3000000 kB'
  ].join('\n'))
  assert.ok(info)
  assert.equal(info.total, 16_000_000 * 1024)
  assert.equal(info.available, 9_000_000 * 1024)
  assert.equal(info.swapTotal, 4_000_000 * 1024)
  assert.equal(info.swapFree, 3_000_000 * 1024)
})

test('parseMeminfo: old kernels fall back to free+buffers+cached', () => {
  const info = parseMeminfo([
    'MemTotal: 1000 kB',
    'MemFree: 100 kB',
    'Buffers: 50 kB',
    'Cached: 200 kB',
    'SReclaimable: 25 kB',
    'Shmem: 25 kB'
  ].join('\n'))
  assert.ok(info)
  assert.equal(info.available, 350 * 1024)
})

test('parseMacSwap: parses total/free with units', () => {
  assert.deepEqual(parseMacSwap('total = 2048.00M  used = 512.00M  free = 1536.00M'), {
    total: 2048 * 1024 ** 2,
    free: 1536 * 1024 ** 2
  })
})
