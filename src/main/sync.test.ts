import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applySync, compareTrees, diffLines, planRows } from './sync.ts'

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'mfm-sync-'))
const trashed: string[] = []
const trash = async (p: string) => {
  trashed.push(p)
  await fs.rm(p, { recursive: true, force: true })
}

async function twoTrees() {
  const root = await tmp()
  const left = path.join(root, 'left')
  const right = path.join(root, 'right')
  await fs.mkdir(path.join(left, 'docs'), { recursive: true })
  await fs.mkdir(path.join(right, 'docs'), { recursive: true })

  await fs.writeFile(path.join(left, 'same.txt'), 'equal')
  await fs.writeFile(path.join(right, 'same.txt'), 'equal')
  const now = new Date()
  await fs.utimes(path.join(left, 'same.txt'), now, now)
  await fs.utimes(path.join(right, 'same.txt'), now, now)

  await fs.writeFile(path.join(left, 'only-left.txt'), 'L')
  await fs.writeFile(path.join(right, 'only-right.txt'), 'R')
  await fs.writeFile(path.join(left, 'docs', 'newer-left.txt'), 'newer content')
  await fs.writeFile(path.join(right, 'docs', 'newer-left.txt'), 'old')
  const old = new Date(Date.now() - 120_000)
  await fs.utimes(path.join(right, 'docs', 'newer-left.txt'), old, old)
  return { root, left, right }
}

test('compareTrees classifies every difference', async () => {
  const { left, right } = await twoTrees()
  const { rows } = await compareTrees(left, right)
  const by = Object.fromEntries(rows.map((r) => [r.rel, r.state]))
  assert.equal(by['same.txt'], 'same')
  assert.equal(by['only-left.txt'], 'leftOnly')
  assert.equal(by['only-right.txt'], 'rightOnly')
  assert.equal(by[path.join('docs', 'newer-left.txt')], 'leftNewer')
  assert.equal(by['docs'], 'same', 'a folder that exists on both sides is not a difference')
})

test('planRows only touches what the direction says', async () => {
  const { left, right } = await twoTrees()
  const { rows } = await compareTrees(left, right)

  const ltr = planRows(rows, 'ltr', false)
  assert.deepEqual(ltr.copy.map((r) => r.rel).sort(), ['docs/newer-left.txt', 'only-left.txt'].sort())
  assert.equal(ltr.remove.length, 0, 'right-only files stay without deleteExtra')

  const ltrDelete = planRows(rows, 'ltr', true)
  assert.deepEqual(ltrDelete.remove.map((r) => r.rel), ['only-right.txt'])

  const rtl = planRows(rows, 'rtl', false)
  assert.deepEqual(rtl.copy.map((r) => r.rel), ['only-right.txt'])
})

test('applySync copies the plan, never hard-deletes, and leaves equal files alone', async () => {
  const { left, right } = await twoTrees()
  const { rows } = await compareTrees(left, right)

  const res = await applySync(left, right, rows, 'ltr', true, trash)
  assert.deepEqual(res.errors, [])
  assert.equal(res.copied, 2)
  assert.equal(res.deleted, 1)
  assert.deepEqual(trashed.length, 1, 'the extra file went through the injected trash, not unlink')

  assert.equal(await fs.readFile(path.join(right, 'only-left.txt'), 'utf8'), 'L')
  assert.equal(await fs.readFile(path.join(right, 'docs', 'newer-left.txt'), 'utf8'), 'newer content')
  assert.equal(await fs.readFile(path.join(right, 'same.txt'), 'utf8'), 'equal')

  const after = await compareTrees(left, right)
  assert.equal(after.rows.filter((r) => r.state !== 'same').length, 0, 'a second compare is clean')
})

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

test('a size difference with the same timestamp is ambiguous and shows up in both directions', async () => {
  const root = await tmp()
  const left = path.join(root, 'l')
  const right = path.join(root, 'r')
  await fs.mkdir(left)
  await fs.mkdir(right)
  const same = new Date('2026-01-01T10:00:00Z')
  await fs.writeFile(path.join(left, 'x.txt'), 'longer content')
  await fs.writeFile(path.join(right, 'x.txt'), 'short')
  await fs.utimes(path.join(left, 'x.txt'), same, same)
  await fs.utimes(path.join(right, 'x.txt'), same, same)

  const { rows } = await compareTrees(left, right)
  assert.equal(rows[0].state, 'sizeDiff')
  assert.deepEqual(planRows(rows, 'ltr', false).copy.map((r) => r.rel), ['x.txt'])
  assert.deepEqual(planRows(rows, 'rtl', false).copy.map((r) => r.rel), ['x.txt'])
})
