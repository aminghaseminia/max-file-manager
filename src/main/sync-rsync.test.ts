import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  applyRsync,
  itemizeToPlan,
  parseItemize,
  parseProgress,
  planRsync,
  rsyncArgs,
  rsyncAvailable,
  trashDirFor,
  type RsyncRequest
} from './sync-rsync.ts'

const base = (over: Partial<RsyncRequest> = {}): RsyncRequest => ({
  src: '/tmp/left',
  dst: '/tmp/right',
  mode: 'ltr',
  deleteExtra: false,
  ignore: [],
  compareBy: 'mtime',
  ...over
})

test('rsyncArgs: archive, newer-wins, safe paths and no shell string', () => {
  const args = rsyncArgs(base(), false, false)
  assert.ok(args.includes('-a'))
  assert.ok(args.includes('--protect-args'))
  assert.ok(args.includes('--update'))
  assert.ok(args.includes('--out-format=%i|%n'))
  assert.deepEqual(args.slice(-3), ['--', '/tmp/left/', '/tmp/right/'])
  // a path with spaces, quotes and a semicolon stays one argv entry
  const weird = rsyncArgs(base({ src: '/tmp/a b; rm -rf /' }), true, false)
  assert.ok(weird.includes('/tmp/a b; rm -rf /'))
  assert.ok(weird.includes('--dry-run'))
})

test('rsyncArgs: hash mode drops --update, adds --checksum', () => {
  const args = rsyncArgs(base({ compareBy: 'hash' }), false, false)
  assert.ok(args.includes('--checksum'))
  assert.equal(args.includes('--update'), false)
})

test('rsyncArgs: delete moves files to the backup dir, exclusions and advanced switches', () => {
  const args = rsyncArgs(
    base({
      deleteExtra: true,
      backupDir: '/tmp/right/.mfm-trash/20260101-100000',
      ignore: ['*.log', 'node_modules'],
      options: {
        compress: true,
        bwlimitKB: 512,
        partial: true,
        inplace: true,
        sparse: true,
        hardLinks: true,
        acls: true,
        xattrs: true
      }
    }),
    false,
    true
  )
  assert.ok(args.includes('--delete'))
  assert.ok(args.includes('--backup'))
  assert.ok(args.includes('--backup-dir=/tmp/right/.mfm-trash/20260101-100000'))
  assert.ok(args.includes('--exclude=*.log'))
  assert.ok(args.includes('--exclude=node_modules'))
  assert.ok(args.includes('--exclude=.mfm-trash'))
  assert.ok(args.includes('--exclude=.mfm-restic'))
  assert.ok(args.includes('--exclude=.mfm.json'))
  assert.ok(args.includes('--compress'))
  assert.ok(args.includes('--bwlimit=512'))
  assert.ok(args.includes('--partial'))
  assert.ok(args.includes('--inplace'))
  assert.ok(args.includes('--sparse'))
  assert.ok(args.includes('--hard-links'))
  assert.ok(args.includes('--acls'))
  assert.ok(args.includes('--xattrs'))
  assert.ok(args.includes('--info=progress2'))
})

test('parseItemize: transfers, deletions, and dirs/links left to rsync', () => {
  const text = [
    '>f+++++++++|new.txt',
    '>f.st......|sub/changed.txt',
    'cd+++++++++|newdir/',
    '*deleting  |gone.txt',
    'hf+++++++++|link.txt',
    'cL+++++++++|symlink',
    ''
  ].join('\n')
  const got = parseItemize(text)
  assert.deepEqual(got.items, [
    { rel: 'new.txt', kind: 'file' },
    { rel: 'sub/changed.txt', kind: 'file' },
    { rel: 'gone.txt', kind: 'delete' }
  ])
  assert.equal(got.capped, false)
})

test('itemizeToPlan: the source/destination sides follow the direction', () => {
  const items = [
    { rel: 'a.txt', kind: 'file' as const },
    { rel: 'b.txt', kind: 'delete' as const }
  ]
  const ltr = itemizeToPlan(items, 'ltr')
  assert.deepEqual(ltr.copy[0], { rel: 'a.txt', kind: 'copy', from: 'left', to: 'right', state: 'contentDiff' })
  assert.deepEqual(ltr.remove[0], { rel: 'b.txt', kind: 'delete', from: 'right', to: 'right', state: 'rightOnly' })
  const rtl = itemizeToPlan(items, 'rtl')
  assert.equal(rtl.copy[0].from, 'right')
  assert.equal(rtl.copy[0].to, 'left')
  assert.equal(rtl.remove[0].from, 'left')
})

test('parseProgress: the last snapshot wins, commas are fine', () => {
  assert.deepEqual(parseProgress('  1,234,567  45%  10.5MB/s  0:00:01'), { bytes: 1234567, pct: 45 })
  assert.deepEqual(parseProgress('100 10%\r200 20%\r'), { bytes: 200, pct: 20 })
  assert.equal(parseProgress('nothing here'), null)
})

test('trashDirFor: inside the destination and timestamped', () => {
  const dir = trashDirFor('/tmp/right')
  assert.ok(dir.startsWith('/tmp/right/.mfm-trash/'))
  assert.match(dir, /\d{8}-\d{6}/)
})

test('integration: a real rsync plan and run copy, then a delete is recoverable', { timeout: 60_000 }, async () => {
  if (!(await rsyncAvailable())) return
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-rsync-'))
  const left = path.join(root, 'left')
  const right = path.join(root, 'right')
  try {
    await fs.mkdir(left, { recursive: true })
    await fs.mkdir(right, { recursive: true })
    await fs.writeFile(path.join(left, 'a.txt'), 'alpha')
    await fs.mkdir(path.join(left, 'sub'))
    await fs.writeFile(path.join(left, 'sub/b.txt'), 'beta')
    await fs.writeFile(path.join(right, 'extra.txt'), 'bye')
    await fs.mkdir(path.join(right, '.mfm-trash'))
    await fs.writeFile(path.join(right, '.mfm-trash/keep.txt'), 'keep')

    const req = base({ src: left, dst: right, deleteExtra: true, backupDir: trashDirFor(right) })
    const plan = await planRsync(req)
    assert.deepEqual(plan.plan.copy.map((a) => a.rel).sort(), ['a.txt', 'sub/b.txt'])
    assert.deepEqual(plan.plan.remove.map((a) => a.rel), ['extra.txt'])
    assert.ok(plan.rows.find((r) => r.rel === 'a.txt')?.left)

    const res = await applyRsync(req, { cancelled: false, paused: false })
    assert.deepEqual(res.errors, [])
    assert.equal(res.copied, 2)
    assert.equal(res.removed, 1)
    assert.equal(await fs.readFile(path.join(right, 'a.txt'), 'utf8'), 'alpha')
    assert.equal(await fs.readFile(path.join(right, 'sub/b.txt'), 'utf8'), 'beta')
    await assert.rejects(() => fs.access(path.join(right, 'extra.txt')))
    assert.equal(await fs.readFile(path.join(right, '.mfm-trash/keep.txt'), 'utf8'), 'keep')
    const trash = (await fs.readdir(path.join(right, '.mfm-trash'))).filter((n) => n !== 'keep.txt')
    assert.equal(trash.length, 1)
    assert.equal(await fs.readFile(path.join(right, '.mfm-trash', trash[0], 'extra.txt'), 'utf8'), 'bye')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('integration: checksum mode transfers same-size/same-time different bytes', { timeout: 60_000 }, async () => {
  if (!(await rsyncAvailable())) return
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-rsync-hash-'))
  const left = path.join(root, 'left')
  const right = path.join(root, 'right')
  try {
    await fs.mkdir(left)
    await fs.mkdir(right)
    await fs.writeFile(path.join(left, 'x.bin'), 'aaaa')
    await fs.writeFile(path.join(right, 'x.bin'), 'bbbb')
    const t = new Date('2026-01-01T00:00:00Z')
    await fs.utimes(path.join(left, 'x.bin'), t, t)
    await fs.utimes(path.join(right, 'x.bin'), t, t)
    const req = base({ src: left, dst: right, compareBy: 'hash' })
    const plan = await planRsync(req)
    assert.deepEqual(plan.plan.copy.map((a) => a.rel), ['x.bin'])
    await applyRsync(req, { cancelled: false, paused: false })
    assert.equal(await fs.readFile(path.join(right, 'x.bin'), 'utf8'), 'aaaa')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
