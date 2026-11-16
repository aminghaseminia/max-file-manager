import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  backup,
  ensureRepo,
  forget,
  parseBackupSummary,
  parseSnapshots,
  resticAvailable,
  restoreToTemp,
  snapshots
} from './sync-versions.ts'

test('parseSnapshots: ids, tags, paths and the summary numbers', () => {
  const text = JSON.stringify([
    {
      id: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      short_id: 'abcdef01',
      time: '2026-11-16T10:00:00+03:30',
      tags: ['mfm'],
      paths: ['/tmp/right'],
      summary: { total_bytes_processed: 1234, total_files_processed: 7 }
    },
    { id: '', time: '' },
    'junk'
  ])
  const got = parseSnapshots(text)
  assert.equal(got.length, 1)
  assert.equal(got[0].shortId, 'abcdef01')
  assert.deepEqual(got[0].paths, ['/tmp/right'])
  assert.equal(got[0].bytes, 1234)
  assert.equal(got[0].files, 7)
  assert.deepEqual(parseSnapshots('not json'), [])
})

test('parseBackupSummary: the last summary line wins; progress lines are ignored', () => {
  const text = [
    '{"message_type":"status","percent_done":0.5}',
    '{"message_type":"status","percent_done":1}',
    '{"message_type":"summary","snapshot_id":"abc123","total_bytes_processed":99,"total_files_processed":3}'
  ].join('\n')
  assert.deepEqual(parseBackupSummary(text), { id: 'abc123', bytes: 99, files: 3 })
  assert.equal(parseBackupSummary('{"message_type":"status"}'), null)
})

test('integration: init, backup, list, restore into a temp tree, prune to one', { timeout: 120_000 }, async () => {
  if (!(await resticAvailable())) return
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-restic-'))
  const src = path.join(root, 'right')
  const repo = path.join(root, 'repo')
  const password = 'mfm-test-password'
  try {
    await fs.mkdir(path.join(src, 'sub'), { recursive: true })
    await fs.writeFile(path.join(src, 'a.txt'), 'alpha')
    await fs.writeFile(path.join(src, 'sub/b.txt'), 'beta')
    await ensureRepo(repo, password)
    const first = await backup(repo, password, src)
    assert.match(first.id, /^[0-9a-f]{64}$/)
    assert.equal(first.files, 2)
    const list = await snapshots(repo, password)
    assert.equal(list.length, 1)
    assert.deepEqual(list[0].paths, [src])

    const restored = await restoreToTemp(repo, password, first.id)
    assert.equal(await fs.readFile(path.join(restored, 'a.txt'), 'utf8'), 'alpha')
    assert.equal(await fs.readFile(path.join(restored, 'sub/b.txt'), 'utf8'), 'beta')

    await fs.writeFile(path.join(src, 'c.txt'), 'gamma')
    await backup(repo, password, src)
    assert.equal((await snapshots(repo, password)).length, 2)
    await forget(repo, password, 1)
    assert.equal((await snapshots(repo, password)).length, 1)

    await assert.rejects(() => snapshots(repo, 'wrong-password'), /password/i)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
