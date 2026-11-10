import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { zipSync } from 'fflate'
import { createZip, extract, isArchive, listArchive } from './archives.ts'

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'mfm-arc-'))
const enc = (s: string) => new TextEncoder().encode(s)

async function makeZip(root: string): Promise<string> {
  const zip = zipSync({
    'a.txt': enc('alpha'),
    'sub/b.txt': enc('beta'),
    'empty.txt': enc('')
  })
  const p = path.join(root, 'sample.zip')
  await fs.writeFile(p, zip)
  return p
}

test('isArchive recognises the formats we can read', () => {
  assert.equal(isArchive('x.zip'), true)
  assert.equal(isArchive('x.tar.gz'), true)
  assert.equal(isArchive('x.tgz'), true)
  assert.equal(isArchive('x.txt'), false)
})

test('listArchive reads zip entries with sizes and archive-qualified paths', async () => {
  const root = await tmp()
  const zip = await makeZip(root)
  const { entries } = await listArchive(zip)
  assert.deepEqual(entries.map((e) => e.name).sort(), ['a.txt', 'empty.txt', 'sub/b.txt'])
  const a = entries.find((e) => e.name === 'a.txt')!
  assert.equal(a.size, 5)
  assert.equal(a.path, `${zip}!a.txt`)
  assert.equal(a.ext, 'txt')
})

test('extract writes only the chosen entries, into the destination', async () => {
  const root = await tmp()
  const zip = await makeZip(root)
  const dest = path.join(root, 'out')
  await fs.mkdir(dest)

  const r = await extract(zip, ['sub/b.txt'], dest)
  assert.deepEqual(r, { done: 1, errors: [] })
  assert.equal(await fs.readFile(path.join(dest, 'sub', 'b.txt'), 'utf8'), 'beta')
  assert.equal(
    await fs.access(path.join(dest, 'a.txt')).then(() => true, () => false),
    false,
    'unselected entries stay inside the archive'
  )
})

test('extract with no names writes everything', async () => {
  const root = await tmp()
  const zip = await makeZip(root)
  const dest = path.join(root, 'all')
  await fs.mkdir(dest)
  const r = await extract(zip, [], dest)
  assert.equal(r.done, 3)
  assert.equal(await fs.readFile(path.join(dest, 'a.txt'), 'utf8'), 'alpha')
})

test('a tar archive is read by the built-in parser', async () => {
  const root = await tmp()
  const body = enc('hello tar')
  const header = Buffer.alloc(512)
  header.write('greeting.txt', 0)
  header.write(body.length.toString(8).padStart(11, '0'), 124)
  header.write('0', 156)
  const pad = Buffer.alloc(512 - (body.length % 512 || 512))
  const tar = path.join(root, 'x.tar')
  await fs.writeFile(tar, Buffer.concat([header, Buffer.from(body), pad, Buffer.alloc(1024)]))

  const { entries } = await listArchive(tar)
  assert.deepEqual(entries.map((e) => e.name), ['greeting.txt'])
  assert.equal(entries[0].size, 9)

  const dest = path.join(root, 'out')
  await fs.mkdir(dest)
  await extract(tar, [], dest)
  assert.equal(await fs.readFile(path.join(dest, 'greeting.txt'), 'utf8'), 'hello tar')
})

test('createZip writes an archive that lists and extracts back to the same bytes', async () => {
  const root = await tmp()
  const src = path.join(root, 'pack')
  await fs.mkdir(path.join(src, 'deep'), { recursive: true })
  await fs.writeFile(path.join(src, 'one.txt'), 'first file')
  await fs.writeFile(path.join(src, 'deep', 'two.txt'), 'second file')
  const outDir = path.join(root, 'out')
  await fs.mkdir(outDir)

  const made = await createZip(outDir, 'بکاپ', [src])
  assert.ok('path' in made, JSON.stringify(made))
  if (!('path' in made)) return
  assert.equal(path.basename(made.path), 'بکاپ.zip')
  assert.equal(made.files, 2)
  assert.equal(isArchive(made.path), true)

  const listed = await listArchive(made.path)
  const names = listed.entries.map((e) => e.name.replace(/\\/g, '/')).sort()
  assert.deepEqual(names, ['pack/deep/two.txt', 'pack/one.txt'])

  const back = path.join(root, 'back')
  await fs.mkdir(back)
  const res = await extract(made.path, [], back)
  assert.deepEqual(res.errors, [])
  assert.equal(await fs.readFile(path.join(back, 'pack', 'one.txt'), 'utf8'), 'first file')
  assert.equal(await fs.readFile(path.join(back, 'pack', 'deep', 'two.txt'), 'utf8'), 'second file')
})

test('createZip never overwrites an existing archive and is empty-safe', async () => {
  const root = await tmp()
  const src = path.join(root, 'f.txt')
  await fs.writeFile(src, 'x')
  const dir = path.join(root, 'out')
  await fs.mkdir(dir)
  await fs.writeFile(path.join(dir, 'a.zip'), 'old')

  const first = await createZip(dir, 'a', [src])
  assert.ok('path' in first)
  if ('path' in first) assert.equal(path.basename(first.path), 'a (2).zip', 'freeName guards the name')

  const empty = await createZip(dir, 'empty', [])
  assert.deepEqual(empty, { error: 'چیزی برای آرشیو کردن نیست' })
})
