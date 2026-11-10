import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { iconsIn, themeDirs } from './icons.ts'
import { LABELS, META_FILE, readMeta, setLabel, setMeta, togglePin } from './meta.ts'

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'mfm-meta-'))

test('setMeta writes a hidden file inside the folder and readMeta reads it', async () => {
  const dir = await tmp()
  assert.equal(await readMeta(dir), null)
  await setMeta(dir, { color: '#e0a44a' })
  assert.ok(await fs.stat(path.join(dir, META_FILE)), 'the marker lives with the folder')
  assert.deepEqual(await readMeta(dir), { color: '#e0a44a' })
})

test('setMeta merges, and empty meta deletes the file', async () => {
  const dir = await tmp()
  await setMeta(dir, { color: '#4c8dff' })
  await setMeta(dir, { icon: '/usr/share/icons/breeze/places/64/folder.svg' })
  assert.deepEqual(await readMeta(dir), {
    color: '#4c8dff',
    icon: '/usr/share/icons/breeze/places/64/folder.svg'
  })
  await setMeta(dir, { color: '', icon: '' })
  assert.equal(await readMeta(dir), null)
  assert.equal(
    await fs.access(path.join(dir, META_FILE)).then(() => true, () => false),
    false,
    'no empty marker file is left behind'
  )
})

test('readMeta ignores junk and unsafe values', async () => {
  const dir = await tmp()
  await fs.writeFile(path.join(dir, META_FILE), '{not json')
  assert.equal(await readMeta(dir), null)
  await fs.writeFile(path.join(dir, META_FILE), JSON.stringify({ color: 'red;}', icon: 'relative.svg' }))
  assert.equal(await readMeta(dir), null, 'non-hex colours and relative icons are dropped')
})

test('iconsIn collects svg/png names and prefers scalable', async () => {
  const root = await tmp()
  for (const p of ['scalable/places/folder.svg', '32/places/folder.svg', '32/places/star.png']) {
    await fs.mkdir(path.join(root, path.dirname(p)), { recursive: true })
    await fs.writeFile(path.join(root, p), '<svg/>')
  }
  const icons = await iconsIn(root)
  assert.deepEqual(icons.map((i) => i.name), ['folder', 'star'])
  assert.match(icons.find((i) => i.name === 'folder')!.path, /scalable/)
})

test('themeDirs lists system themes and user-added packs', async () => {
  const pack = await tmp()
  await fs.mkdir(path.join(pack, 'sub'))
  await fs.writeFile(path.join(pack, 'thing.svg'), '<svg/>')
  const themes = await themeDirs([pack])
  assert.ok(themes.some((t) => t.dir === pack), 'the extra pack is offered')
  assert.ok(themes.length >= 1)
})

test('pins round-trip and reject names that could escape the folder', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-pins-'))
  assert.deepEqual(await togglePin(dir, 'photo.png'), ['photo.png'])
  assert.deepEqual(await togglePin(dir, 'notes.txt'), ['photo.png', 'notes.txt'])
  assert.deepEqual(await togglePin(dir, 'photo.png'), ['notes.txt'], 'second toggle removes it')
  assert.deepEqual((await readMeta(dir))?.pins, ['notes.txt'])

  assert.deepEqual(await togglePin(dir, '../escape'), [])
  assert.deepEqual(await togglePin(dir, 'a/b'), [])
  assert.deepEqual((await readMeta(dir))?.pins, ['notes.txt'], 'bad names change nothing')

  await togglePin(dir, 'notes.txt')
  assert.equal(await readMeta(dir), null, 'the meta file disappears when nothing is left')
})

test('labels round-trip, reject unknown ids and unsafe names', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-labels-'))
  assert.deepEqual(await setLabel(dir, 'a.txt', 'red'), { 'a.txt': 'red' })
  assert.deepEqual(await setLabel(dir, 'b.txt', 'blue'), { 'a.txt': 'red', 'b.txt': 'blue' })
  assert.deepEqual(await setLabel(dir, 'a.txt', 'blue'), { 'a.txt': 'blue', 'b.txt': 'blue' })
  assert.deepEqual(await setLabel(dir, 'a.txt', null), { 'b.txt': 'blue' }, 'null clears')
  assert.deepEqual(await setLabel(dir, 'c.txt', 'hotpink'), { 'b.txt': 'blue' }, 'unknown id ignored')
  assert.deepEqual(await setLabel(dir, '../x', 'red'), {}, 'escaping name rejected')

  await fs.writeFile(path.join(dir, META_FILE), JSON.stringify({ labels: { 'ok.txt': 'red', '../x': 'red', 'y.txt': 'nope' } }))
  assert.deepEqual((await readMeta(dir))?.labels, { 'ok.txt': 'red' }, 'reading drops garbage')

  assert.equal(LABELS.length, 8)
})
