import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { breakdown } from './breakdown.ts'

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'mfm-bd-'))

async function fixture(): Promise<string> {
  const root = await tmp()
  await fs.mkdir(path.join(root, 'photos'), { recursive: true })
  await fs.mkdir(path.join(root, 'photos', 'raw'), { recursive: true })
  await fs.mkdir(path.join(root, 'docs'), { recursive: true })
  await fs.writeFile(path.join(root, 'readme.md'), Buffer.alloc(100, 1))
  await fs.writeFile(path.join(root, 'photos', 'a.jpg'), Buffer.alloc(1000, 1))
  await fs.writeFile(path.join(root, 'photos', 'b.jpg'), Buffer.alloc(500, 1))
  await fs.writeFile(path.join(root, 'photos', 'raw', 'c.png'), Buffer.alloc(2000, 1))
  await fs.writeFile(path.join(root, 'docs', 'letter.txt'), Buffer.alloc(300, 1))
  return root
}

test('all levels: totals, extensions, largest files and child sizes', async () => {
  const root = await fixture()
  const r = await breakdown(root)
  assert.equal(r.mode, 'all')
  assert.equal(r.files, 5)
  assert.equal(r.folders, 3)
  assert.equal(r.bytes, 3900)
  assert.equal(r.capped, false)

  const jpg = r.byExt.find((e) => e.key === 'jpg')
  assert.deepEqual(jpg, { key: 'jpg', count: 2, bytes: 1500 })

  assert.deepEqual(
    r.largest.map((f) => [f.rel, f.size]),
    [
      [path.join('photos', 'raw', 'c.png'), 2000],
      [path.join('photos', 'a.jpg'), 1000],
      [path.join('photos', 'b.jpg'), 500],
      [path.join('docs', 'letter.txt'), 300],
      ['readme.md', 100]
    ]
  )

  const photos = r.children.find((c) => c.name === 'photos')
  assert.equal(photos?.bytes, 3500)
  assert.equal(photos?.files, 3)
  assert.equal(r.children[0].name, 'photos')
})

test('level 1 counts only the folder itself and keeps child folders unscanned', async () => {
  const root = await fixture()
  const r = await breakdown(root, { mode: 'level1' })
  assert.equal(r.files, 1)
  assert.equal(r.bytes, 100)
  assert.equal(r.folders, 2)
  assert.deepEqual(r.byExt.map((e) => e.key), ['md'])
  assert.equal(r.children.find((c) => c.name === 'photos')?.bytes, 0)
})

test('the largest list keeps only the requested number of files', async () => {
  const root = await tmp()
  for (const n of [10, 30, 20, 5]) {
    await fs.writeFile(path.join(root, `f${n}.bin`), Buffer.alloc(n, 1))
  }
  const r = await breakdown(root, { topFiles: 2 })
  assert.deepEqual(r.largest.map((f) => f.size), [30, 20])
})

test('an empty folder is all zeroes, not an error', async () => {
  const root = await tmp()
  const r = await breakdown(root)
  assert.equal(r.files, 0)
  assert.equal(r.bytes, 0)
  assert.deepEqual(r.byExt, [])
  assert.deepEqual(r.children, [])
})

test('a scan that runs out of entries reports capped instead of a partial total as complete', async () => {
  const root = await tmp()
  for (let i = 0; i < 1_100; i++) {
    await fs.writeFile(path.join(root, `f${i}.bin`), Buffer.alloc(4, 1))
  }
  const r = await breakdown(root, { maxEntries: 1_000 })
  assert.equal(r.capped, true)
  assert.ok(r.scanned <= 1_000)
  assert.ok(r.files <= 1_000)
})
