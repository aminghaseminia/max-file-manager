import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanRemoteName,
  conflictPaths,
  entryState,
  nextBackoff,
  nextRunAt,
  remoteJoin,
  remoteName,
  remoteParent
} from './cloud-core.ts'
import type { SyncRow } from '../shared/sync.ts'

test('backoff doubles and stops at the ceiling', () => {
  assert.equal(nextBackoff(0, 60_000), 60_000)
  assert.equal(nextBackoff(1, 60_000), 120_000)
  assert.equal(nextBackoff(3, 60_000), 480_000)
  assert.equal(nextBackoff(50, 60_000), 30 * 60_000)
})

test('a dirty folder runs after a short debounce, a paused one never', () => {
  const now = 1_000_000
  assert.equal(nextRunAt({ intervalMs: 900_000, enabled: false }, { lastRunAt: null, dirty: true }, now), null)
  assert.equal(nextRunAt({ intervalMs: 900_000, enabled: true }, { lastRunAt: now - 1, dirty: true }, now), now + 2_000)
  assert.equal(nextRunAt({ intervalMs: 900_000, enabled: true }, { lastRunAt: now, dirty: false }, now), now + 900_000)
  assert.equal(nextRunAt({ intervalMs: 60_000, enabled: true }, { lastRunAt: now, dirty: false }, now, 2), now + 240_000)
})

test('entry state follows the binding state', () => {
  assert.equal(entryState('idle', false), 'synced')
  assert.equal(entryState('idle', true), 'pending')
  assert.equal(entryState('syncing', false), 'syncing')
  assert.equal(entryState('checking', true), 'syncing')
  assert.equal(entryState('conflict', false), 'conflict')
  assert.equal(entryState('paused', false), 'paused')
  assert.equal(entryState('offline', false), 'offline')
  assert.equal(entryState('error', false), 'error')
})

test('remote paths join, parent and name', () => {
  assert.equal(remoteJoin('/', 'Docs'), '/Docs')
  assert.equal(remoteJoin('/a/b', 'c'), '/a/b/c')
  assert.equal(remoteJoin('/a/b/', '/c'), '/a/b/c')
  assert.equal(remoteParent('/a/b'), '/a')
  assert.equal(remoteParent('/a'), '/')
  assert.equal(remoteParent('/'), '/')
  assert.equal(remoteName('/a/b'), 'b')
  assert.equal(remoteName('/'), '/')
})

test('a new folder name cannot escape its parent', () => {
  assert.equal(cleanRemoteName('Docs'), 'Docs')
  assert.equal(cleanRemoteName('  Docs  '), 'Docs')
  assert.equal(cleanRemoteName(''), null)
  assert.equal(cleanRemoteName('..'), null)
  assert.equal(cleanRemoteName('a/b'), null)
  assert.equal(cleanRemoteName('a\\b'), null)
  assert.equal(cleanRemoteName('x'.repeat(200)), null)
})

test('conflict rows are the ones a run may not touch', () => {
  const rows: SyncRow[] = [
    { rel: 'a.txt', state: 'conflict' },
    { rel: 'b', state: 'typeDiff' },
    { rel: 'c.txt', state: 'leftOnly' },
    { rel: 'd.txt', state: 'same' }
  ]
  assert.deepEqual(conflictPaths(rows), ['a.txt', 'b'])
})
