import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { findDupes, nameMatcher, walk } from './search.ts'

async function tree() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-walk-'))
  await fs.mkdir(path.join(root, 'sub'))
  await fs.writeFile(path.join(root, 'a.txt'), 'hello')
  await fs.writeFile(path.join(root, 'b.txt'), 'hello')
  await fs.writeFile(path.join(root, 'c.txt'), 'world')
  await fs.writeFile(path.join(root, 'sub', 'd.txt'), 'hello')
  await fs.writeFile(path.join(root, 'blob.bin'), Buffer.alloc(5000, 1))
  return root
}

test('nameMatcher: literal, wildcard, regex, broken regex', () => {
  assert.equal(nameMatcher('report', false)('my-Report.txt'), true)
  assert.equal(nameMatcher('report', false)('other.txt'), false)
  assert.equal(nameMatcher('*.txt', false)('a.txt'), true)
  assert.equal(nameMatcher('*.txt', false)('a.txt.bak'), false)
  assert.equal(nameMatcher('a?.txt', false)('ab.txt'), true)
  assert.equal(nameMatcher('^[ab]\\.txt$', true)('a.txt'), true)
  assert.equal(nameMatcher('^[ab]\\.txt$', true)('c.txt'), false)
  assert.equal(nameMatcher('(unclosed', true)('x(unclosed.txt'), true, 'broken regex falls back to literal')
})

test('walk: wildcard, relative names, recursion', async () => {
  const root = await tree()
  const r = await walk(root, { query: '*.txt' })
  assert.equal(r.capped, false)
  assert.deepEqual(
    r.entries.map((e) => e.name).sort(),
    ['a.txt', 'b.txt', 'c.txt', 'sub/d.txt']
  )
  assert.ok(r.entries.every((e) => path.isAbsolute(e.path)))
})

test('walk: content search and size filters', async () => {
  const root = await tree()
  const content = await walk(root, { content: 'HELLO' })
  assert.deepEqual(content.entries.map((e) => e.name).sort(), ['a.txt', 'b.txt', 'sub/d.txt'])

  const big = await walk(root, { minSize: 1000 })
  assert.deepEqual(big.entries.map((e) => e.name), ['blob.bin'])
})

test('walk: limit is reported, not silently dropped', async () => {
  const root = await tree()
  const r = await walk(root, { limit: 2 })
  assert.equal(r.entries.length, 2)
  assert.equal(r.capped, true)
})

test('findDupes groups only identical files', async () => {
  const root = await tree()
  const { entries } = await findDupes(root)
  assert.deepEqual(entries.map((e) => e.name).sort(), ['a.txt', 'b.txt', 'sub/d.txt'])
  assert.equal(new Set(entries.map((e) => e.group)).size, 1, 'all three share one group')
  assert.equal(entries.every((e) => e.group === 1), true)
})
