import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { clearIndex, closeDb, getAppKV, indexRoots, searchIndex, setAppKV } from './searchdb.ts'

test('search treats dots, dashes and spaces as the same word boundary', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mfm-searchdb-'))
  const db = path.join(dir, 'search.db')
  t.after(async () => {
    closeDb()
    await rm(dir, { recursive: true, force: true })
  })
  await mkdir(path.join(dir, 'sub'))
  await writeFile(path.join(dir, 'mim.for.me.4.3.1.md'), 'x')
  await writeFile(path.join(dir, 'meeting-notes.txt'), 'x')
  await writeFile(path.join(dir, 'sub', 'mim-extra.txt'), 'x')
  await indexRoots(db, { roots: [dir], exclude: [] })

  const names = (q: string) => searchIndex(db, q, 50).map((r) => r.name)
  // the exact complaint: typing spaces must find a dotted name
  assert.ok(names('mim for me').includes('mim.for.me.4.3.1.md'))
  assert.ok(names('mim.for.me').includes('mim.for.me.4.3.1.md'))
  assert.ok(names('MIM FOR ME').includes('mim.for.me.4.3.1.md'))
  assert.ok(names('me mim for').includes('mim.for.me.4.3.1.md'))
  assert.ok(names('me notes').includes('meeting-notes.txt'))
  assert.ok(names('mim extra').includes('mim-extra.txt'))
  assert.deepEqual(names('zzz-nothing'), [])
})

test('clearing the index keeps the settings table', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mfm-searchdb-'))
  const db = path.join(dir, 'search.db')
  t.after(async () => {
    closeDb()
    await rm(dir, { recursive: true, force: true })
  })
  setAppKV(db, 'state', '{"prefs":{}}')
  await writeFile(path.join(dir, 'a.txt'), 'x')
  await indexRoots(db, { roots: [dir], exclude: [] })
  assert.ok(searchIndex(db, 'a').length > 0)
  clearIndex(db)
  assert.equal(searchIndex(db, 'a').length, 0)
  assert.equal(getAppKV(db, 'state'), '{"prefs":{}}')
})
