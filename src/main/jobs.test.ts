import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createEngine, type Job } from './jobs.ts'

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'mfm-'))
const exists = (p: string) => fs.access(p).then(() => true, () => false)

const engine = () => {
  const seen: Job[] = []
  return { e: createEngine((j) => seen.push(j)), seen }
}

/** Jobs run on a chain; wait until the last one stops being queued/running. */
async function settle(seen: Job[]): Promise<Job> {
  for (let i = 0; i < 400; i++) {
    const last = seen[seen.length - 1]
    if (last && ['done', 'error', 'cancelled'].includes(last.state)) return last
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('job did not settle')
}

test('copy reports bytes and keeps the source', async () => {
  const root = await tmp()
  const src = path.join(root, 'big.bin')
  const dest = path.join(root, 'dest')
  await fs.writeFile(src, Buffer.alloc(3 * 1024 * 1024, 7))
  await fs.mkdir(dest)

  const { e, seen } = engine()
  e.start('copy', [src], dest)
  const job = await settle(seen)

  assert.equal(job.state, 'done')
  assert.equal(job.bytes, 3 * 1024 * 1024)
  assert.equal(job.done, job.bytes, 'every byte is accounted for')
  assert.ok(await exists(src))
  assert.equal((await fs.stat(path.join(dest, 'big.bin'))).size, job.bytes)
})

test('move deletes the source and can be undone', async () => {
  const root = await tmp()
  const src = path.join(root, 'dir')
  const dest = path.join(root, 'dest')
  await fs.mkdir(src)
  await fs.writeFile(path.join(src, 'inner.txt'), 'content')
  await fs.mkdir(dest)

  const { e, seen } = engine()
  e.start('move', [src], dest)
  assert.equal((await settle(seen)).state, 'done')
  assert.equal(await exists(src), false)
  assert.equal(await fs.readFile(path.join(dest, 'dir', 'inner.txt'), 'utf8'), 'content')

  assert.equal(e.undoDepth(), 1)
  const u = await e.undo()
  assert.equal(u.done, 1)
  assert.equal(await fs.readFile(path.join(src, 'inner.txt'), 'utf8'), 'content', 'undo moves it back')
  assert.equal(await exists(path.join(dest, 'dir')), false)
})

test('cancel stops the transfer and leaves no partial file', async () => {
  const root = await tmp()
  const src = path.join(root, 'huge.bin')
  const dest = path.join(root, 'dest')
  await fs.writeFile(src, Buffer.alloc(24 * 1024 * 1024, 3))
  await fs.mkdir(dest)

  const { e, seen } = engine()
  const job = e.start('copy', [src], dest)
  for (let i = 0; i < 200 && !seen.some((j) => j.state === 'running'); i++) {
    await new Promise((r) => setTimeout(r, 10))
  }
  e.cancel(job.id)
  const end = await settle(seen)

  assert.equal(end.state, 'cancelled')
  assert.equal(await exists(path.join(dest, 'huge.bin')), false, 'partial copy is removed')
})

test('renameMany renames and undo reverses it', async () => {
  const root = await tmp()
  const names = ['a.txt', 'b.txt']
  for (const n of names) await fs.writeFile(path.join(root, n), n)

  const { e } = engine()
  const r = await e.renameMany([
    { from: path.join(root, 'a.txt'), to: path.join(root, 'x-a.txt') },
    { from: path.join(root, 'b.txt'), to: path.join(root, 'x-b.txt') }
  ])
  assert.deepEqual(r, { done: 2, errors: [] })
  assert.ok(await exists(path.join(root, 'x-a.txt')))

  await e.undo()
  assert.ok(await exists(path.join(root, 'a.txt')))
  assert.equal(await exists(path.join(root, 'x-a.txt')), false)
})

test('makeDir creates and undo removes it', async () => {
  const root = await tmp()
  const { e } = engine()
  assert.deepEqual(await e.makeDir(root, 'new folder'), { done: 1, errors: [] })
  assert.ok(await exists(path.join(root, 'new folder')))
  await e.undo()
  assert.equal(await exists(path.join(root, 'new folder')), false)
})

test('a bad destination fails the job instead of guessing', async () => {
  const root = await tmp()
  const src = path.join(root, 'a.txt')
  await fs.writeFile(src, 'x')
  const { e, seen } = engine()
  e.start('copy', [src], 'relative/dest')
  const job = await settle(seen)
  assert.equal(job.state, 'error')
  assert.match(job.errors[0], /destination/)
})
