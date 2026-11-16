import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { diffFiles, diffLines } from './sync.ts'

test('diffLines reports added and removed lines with numbers', () => {
  const d = diffLines(['a', 'b', 'c', 'd'], ['a', 'c', 'd', 'e'])
  assert.equal(d.removed, 1)
  assert.equal(d.added, 1)
  assert.deepEqual(
    d.lines.filter((l) => l.kind === 'del').map((l) => [l.a, l.text]),
    [[2, 'b']]
  )
  assert.deepEqual(
    d.lines.filter((l) => l.kind === 'add').map((l) => [l.b, l.text]),
    [[4, 'e']]
  )
  assert.equal(d.lines.filter((l) => l.kind === 'same').length, 3)
})

test('diffLines falls back to a positional diff on huge input', () => {
  const a = Array.from({ length: 900 }, (_, i) => `line ${i}`)
  const b = [...a]
  b[500] = 'changed'
  const d = diffLines(a, b)
  assert.equal(d.coarse, true)
  assert.equal(d.added, 1)
  assert.equal(d.removed, 1)
})

test('diffFiles: text files, a binary pair, and a missing path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-diff-'))
  try {
    const a = path.join(root, 'a.txt')
    const b = path.join(root, 'b.txt')
    await fs.writeFile(a, 'one\ntwo\n')
    await fs.writeFile(b, 'one\nthree\n')
    const text = await diffFiles(a, b)
    assert.equal(text.binary, false)
    assert.equal(text.added, 1)
    assert.equal(text.removed, 1)

    const binA = path.join(root, 'x.bin')
    const binB = path.join(root, 'y.bin')
    await fs.writeFile(binA, Buffer.from([0, 1, 2, 3]))
    await fs.writeFile(binB, Buffer.from([0, 1, 9, 3]))
    const bin = await diffFiles(binA, binB)
    assert.equal(bin.binary, true)
    assert.match(bin.lines[0].text, /بایت 2/)

    const missing = await diffFiles(a, path.join(root, 'nope.txt'))
    assert.deepEqual(missing.lines, [])
    assert.equal(missing.added, 0)

    const relative = await diffFiles('a.txt', 'b.txt')
    assert.deepEqual(relative.lines, [])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
