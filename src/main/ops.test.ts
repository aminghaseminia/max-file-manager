import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runOp } from './ops.ts'

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'mfm-'))
const exists = (p: string) => fs.access(p).then(() => true, () => false)

test('copy keeps the source and dodges an existing name', async () => {
  const root = await tmp()
  const src = path.join(root, 'a.txt')
  const dest = path.join(root, 'dest')
  await fs.mkdir(dest)
  await fs.writeFile(src, 'one')
  await fs.writeFile(path.join(dest, 'a.txt'), 'already here')

  const r = await runOp('copy', [src], { dest })
  assert.deepEqual(r, { done: 1, errors: [] })
  assert.ok(await exists(src), 'source must survive a copy')
  assert.equal(await fs.readFile(path.join(dest, 'a (2).txt'), 'utf8'), 'one')
  assert.equal(await fs.readFile(path.join(dest, 'a.txt'), 'utf8'), 'already here', 'must not overwrite')
})

test('move removes the source, folders included', async () => {
  const root = await tmp()
  const src = path.join(root, 'dir')
  const dest = path.join(root, 'dest')
  await fs.mkdir(src)
  await fs.writeFile(path.join(src, 'inner.txt'), 'x')
  await fs.mkdir(dest)

  const r = await runOp('move', [src], { dest })
  assert.deepEqual(r, { done: 1, errors: [] })
  assert.equal(await exists(src), false)
  assert.equal(await fs.readFile(path.join(dest, 'dir', 'inner.txt'), 'utf8'), 'x')
})

test('trash is delegated, not done here', async () => {
  const root = await tmp()
  const src = path.join(root, 'gone.txt')
  await fs.writeFile(src, 'x')
  const trashed: string[] = []

  const r = await runOp('trash', [src], { trash: async (p) => void trashed.push(p) })
  assert.deepEqual(r, { done: 1, errors: [] })
  assert.deepEqual(trashed, [src])
})

test('mkdir, rename, delete', async () => {
  const root = await tmp()
  assert.deepEqual(await runOp('mkdir', [root], { name: 'new folder' }), { done: 1, errors: [] })
  assert.ok(await exists(path.join(root, 'new folder')))

  const f = path.join(root, 'old.txt')
  await fs.writeFile(f, 'x')
  assert.deepEqual(await runOp('rename', [f], { name: 'new.txt' }), { done: 1, errors: [] })
  assert.ok(await exists(path.join(root, 'new.txt')))

  assert.deepEqual(await runOp('delete', [path.join(root, 'new.txt')]), { done: 1, errors: [] })
  assert.equal(await exists(path.join(root, 'new.txt')), false)
})

test('relative paths and missing destinations are refused, not guessed', async () => {
  const r1 = await runOp('delete', ['relative/path'])
  assert.equal(r1.done, 0)
  assert.match(r1.errors[0], /absolute/)
  const r2 = await runOp('copy', [path.join(os.tmpdir(), 'whatever')])
  assert.equal(r2.done, 0)
  assert.match(r2.errors[0], /destination/)
  const r3 = await runOp('mkdir', [os.tmpdir()])
  assert.equal(r3.done, 0)
  assert.match(r3.errors[0], /folder name/)
})
