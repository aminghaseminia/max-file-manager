import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { saveImage } from './image.ts'

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'mfm-img-'))
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('copy mode writes a sibling file and leaves the original alone', async () => {
  const root = await tmp()
  const src = path.join(root, 'photo.png')
  await fs.writeFile(src, 'original')

  const r = await saveImage(src, PNG_1PX, 'copy')
  assert.ok('path' in r)
  assert.equal(path.basename(r.path), 'photo-edit.png')
  assert.equal(await fs.readFile(src, 'utf8'), 'original', 'original untouched')
  const bytes = await fs.readFile(r.path)
  assert.ok(bytes.length > 50)
  assert.equal(bytes[1], 0x50, 'PNG signature')
})

test('a second copy gets a numbered name', async () => {
  const root = await tmp()
  const src = path.join(root, 'photo.png')
  await fs.writeFile(src, 'original')
  await saveImage(src, PNG_1PX, 'copy')
  const r2 = await saveImage(src, PNG_1PX, 'copy')
  assert.ok('path' in r2)
  assert.equal(path.basename(r2.path), 'photo-edit (2).png')
})

test('overwrite replaces in place and leaves no temp file', async () => {
  const root = await tmp()
  const src = path.join(root, 'photo.png')
  await fs.writeFile(src, 'original')
  const r = await saveImage(src, PNG_1PX, 'overwrite')
  assert.ok('path' in r)
  assert.equal(r.path, src)
  assert.equal((await fs.readFile(src))[1], 0x50)
  const leftovers = (await fs.readdir(root)).filter((f) => f.startsWith('.mfm-save-'))
  assert.deepEqual(leftovers, [])
})

test('jpeg data urls keep a jpg extension', async () => {
  const root = await tmp()
  const src = path.join(root, 'p.jpg')
  await fs.writeFile(src, 'x')
  const r = await saveImage(src, 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', 'copy')
  assert.ok('path' in r)
  assert.match(r.path, /\.jpg$/)
})

test('bad data and relative paths are refused', async () => {
  assert.deepEqual(await saveImage('/tmp/x.png', 'not-an-image', 'copy'), {
    error: 'دادهٔ تصویر نامعتبر است'
  })
  const r = await saveImage('relative.png', PNG_1PX, 'copy')
  assert.ok('error' in r)
})
