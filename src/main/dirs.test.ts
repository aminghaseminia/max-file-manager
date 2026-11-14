import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { dirs } from './dirs.ts'

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'mfm-dirs-'))

async function fixture(): Promise<string> {
  const root = await tmp()
  await fs.mkdir(path.join(root, 'real'))
  await fs.mkdir(path.join(root, '.hidden-dir'))
  await fs.writeFile(path.join(root, 'file.txt'), 'x')
  await fs.symlink(path.join(root, 'real'), path.join(root, 'linked'))
  await fs.symlink(path.join(root, 'missing'), path.join(root, 'broken'))
  await fs.symlink(path.join(root, 'file.txt'), path.join(root, 'linked-file'))
  return root
}

test('dirs returns real folders only by default', async () => {
  const root = await fixture()
  const names = (await dirs(root)).map((d) => d.name)
  assert.deepEqual(names, ['real'])
})

test('followLinks adds symlinked folders and marks them', async () => {
  const root = await fixture()
  const rows = await dirs(root, { followLinks: true })
  const names = rows.map((d) => d.name)
  assert.deepEqual(names.sort(), ['linked', 'real'])
  assert.equal(rows.find((d) => d.name === 'linked')?.link, true)
  assert.equal(rows.find((d) => d.name === 'real')?.link, undefined)
})

test('a broken link and a link to a file are never listed as folders', async () => {
  const root = await fixture()
  const names = (await dirs(root, { followLinks: true })).map((d) => d.name)
  assert.ok(!names.includes('broken'))
  assert.ok(!names.includes('linked-file'))
})

test('hidden entries follow showHidden, links included', async () => {
  const root = await fixture()
  await fs.symlink(path.join(root, 'real'), path.join(root, '.hidden-link'))
  const hidden = (await dirs(root, { followLinks: true })).map((d) => d.name)
  assert.ok(!hidden.includes('.hidden-dir'))
  assert.ok(!hidden.includes('.hidden-link'))
  const shown = (await dirs(root, { showHidden: true, followLinks: true })).map((d) => d.name)
  assert.ok(shown.includes('.hidden-dir'))
  assert.ok(shown.includes('.hidden-link'))
  assert.equal(shown.find((n) => n === '.hidden-link') === undefined, false)
})

test('a missing folder is an empty list, not an error', async () => {
  assert.deepEqual(await dirs('/definitely/not/here'), [])
})
