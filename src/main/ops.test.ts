import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { freeName, remove } from './ops.ts'

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'mfm-'))
const exists = (p: string) => fs.access(p).then(() => true, () => false)

test('remove: trash is delegated, permanent deletes', async () => {
  const root = await tmp()
  const a = path.join(root, 'a.txt')
  const b = path.join(root, 'b.txt')
  await fs.writeFile(a, 'x')
  await fs.writeFile(b, 'x')
  const trashed: string[] = []

  assert.deepEqual(await remove([a], { trash: async (p) => void trashed.push(p) }), { done: 1, errors: [] })
  assert.deepEqual(trashed, [a])
  assert.ok(await exists(a), 'the trash callback owns the file, not us')

  assert.deepEqual(await remove([b]), { done: 1, errors: [] })
  assert.equal(await exists(b), false)
})

test('remove: relative paths are refused', async () => {
  const r = await remove(['relative/path'])
  assert.equal(r.done, 0)
  assert.match(r.errors[0], /absolute/)
})

test('freeName dodges an existing name', async () => {
  const root = await tmp()
  await fs.writeFile(path.join(root, 'a.txt'), 'one')
  assert.equal(await freeName(path.join(root, 'a.txt')), path.join(root, 'a (2).txt'))
  await fs.writeFile(path.join(root, 'a (2).txt'), 'two')
  assert.equal(await freeName(path.join(root, 'a.txt')), path.join(root, 'a (3).txt'))
})

test('remove: a missing path is force-removed silently, the rest still goes', async () => {
  const root = await tmp()
  const ok = path.join(root, 'ok.txt')
  await fs.writeFile(ok, 'x')
  const r = await remove([path.join(root, 'missing.txt'), ok])
  assert.deepEqual(r, { done: 2, errors: [] })
  assert.equal(await exists(ok), false)
})
