import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createSymlink, freeName, remove, symlinkType } from './ops.ts'

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

test('symlinkType: Windows junctions folders and uses file links for files', () => {
  assert.equal(symlinkType('win32', true), 'junction')
  assert.equal(symlinkType('win32', false), 'file')
  assert.equal(symlinkType('linux', true), 'dir')
  assert.equal(symlinkType('linux', false), 'file')
})

test('createSymlink: real link to a file and a folder, never overwrites', async () => {
  const root = await tmp()
  const file = path.join(root, 'note.txt')
  const dir = path.join(root, 'sub')
  await fs.writeFile(file, 'x')
  await fs.mkdir(dir)

  const f = await createSymlink(file, path.join(root, 'note-link'))
  assert.equal(f.ok, true)
  assert.equal(await fs.readlink(path.join(root, 'note-link')), file)

  const d = await createSymlink(dir, path.join(root, 'sub-link'))
  assert.equal(d.ok, true)
  assert.equal(await fs.readlink(path.join(root, 'sub-link')), dir)

  const again = await createSymlink(file, path.join(root, 'note-link'))
  assert.equal(again.ok, false)
  assert.match(again.ok === false ? again.error : '', /already exists/)
})

test('createSymlink: refuses a missing target and relative paths', async () => {
  const root = await tmp()
  const missing = await createSymlink(path.join(root, 'nope'), path.join(root, 'link'))
  assert.equal(missing.ok, false)
  const relative = await createSymlink('note.txt', path.join(root, 'link'))
  assert.equal(relative.ok, false)
  assert.match(relative.ok === false ? relative.error : '', /absolute/)
})
