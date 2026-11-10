import assert from 'node:assert/strict'
import test from 'node:test'
import { baseName, crumbs, fmtDate, fmtSize, sortEntries } from './format.ts'

type Entry = { name: string; path: string; dir: boolean; size: number; mtime: number; ext: string }

const e = (name: string, dir: boolean, size = 0, mtime = 0, ext = ''): Entry => ({
  name,
  path: '/' + name,
  dir,
  size,
  mtime,
  ext
})

test('fmtSize', () => {
  assert.equal(fmtSize(0, false), '0 B')
  assert.equal(fmtSize(999, false), '999 B')
  assert.equal(fmtSize(1024, false), '1.0 KB')
  assert.equal(fmtSize(1536, false), '1.5 KB')
  assert.equal(fmtSize(1048576, false), '1.0 MB')
  assert.equal(fmtSize(12345678, false), '12 MB')
  assert.equal(fmtSize(5000, true), '')
})

test('fmtDate', () => {
  assert.equal(fmtDate(0), '')
  assert.match(fmtDate(Date.UTC(2026, 0, 2, 3, 4)), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
})

test('crumbs: posix and windows', () => {
  assert.deepEqual(crumbs('/').map((c) => c.name), ['/'])
  assert.deepEqual(crumbs('/home/maxv').map((c) => c.path), ['/', '/home', '/home/maxv'])
  assert.deepEqual(crumbs('C:\\Users\\max').map((c) => c.path), ['C:\\', 'C:\\Users', 'C:\\Users\\max'])
  assert.deepEqual(crumbs('D:/a/b').map((c) => c.name), ['D:', 'a', 'b'])
})

test('baseName', () => {
  assert.equal(baseName('/home/maxv/'), 'maxv')
  assert.equal(baseName('C:\\x\\y.txt'), 'y.txt')
})

test('sortEntries: folders first, then column', () => {
  const list = [e('b.txt', false, 10), e('a.txt', false, 30), e('zdir', true), e('file10', false, 5), e('file2', false, 5)]
  assert.deepEqual(
    sortEntries(list, 'name', true).map((x) => x.name),
    ['zdir', 'a.txt', 'b.txt', 'file2', 'file10']
  )
  assert.deepEqual(
    sortEntries(list, 'size', true).map((x) => x.name),
    ['zdir', 'file2', 'file10', 'b.txt', 'a.txt']
  )
  assert.equal(sortEntries(list, 'name', false)[0].name, 'zdir', 'folders stay first when descending')
})
