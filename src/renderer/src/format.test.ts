import assert from 'node:assert/strict'
import test from 'node:test'
import {
  baseName,
  crumbs,
  dirOf,
  fa,
  fmtDate,
  fmtSize,
  groupLabel,
  joinPath,
  kindOf,
  mediaUrl,
  orderEntries,
  planRename,
  sortEntries,
  typeLabel
} from './format.ts'

type Entry = { name: string; path: string; dir: boolean; size: number; mtime: number; ext: string }

const e = (name: string, dir: boolean, size = 0, mtime = 0, ext = ''): Entry => ({
  name,
  path: '/' + name,
  dir,
  size,
  mtime,
  ext
})

test('fa: Persian digits', () => {
  assert.equal(fa(2026), '۲۰۲۶')
  assert.equal(fa('a1b2'), 'a۱b۲')
})

test('fmtSize in Persian', () => {
  assert.equal(fmtSize(0, false), '۰ بایت')
  assert.equal(fmtSize(999, false), '۹۹۹ بایت')
  assert.equal(fmtSize(1024, false), '۱٫۰ کیلوبایت')
  assert.equal(fmtSize(1536, false), '۱٫۵ کیلوبایت')
  assert.equal(fmtSize(1048576, false), '۱٫۰ مگابایت')
  assert.equal(fmtSize(12345678, false), '۱۲ مگابایت')
  assert.equal(fmtSize(5000, true), '', 'folders report nothing unless computed')
})

test('fmtDate: padded and Persian', () => {
  assert.equal(fmtDate(0), '')
  assert.match(fmtDate(Date.UTC(2026, 0, 2, 3, 4)), /^[۰-۹]{4}-[۰-۹]{2}-[۰-۹]{2} [۰-۹]{2}:[۰-۹]{2}$/)
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

test('mediaUrl: encodable and windows-safe', () => {
  assert.equal(mediaUrl('/home/a b/c.png'), 'mfm://local/home/a%20b/c.png')
  assert.equal(mediaUrl('C:\\Users\\max\\x.png'), 'mfm://local/C:/Users/max/x.png')
})

test('kindOf and typeLabel', () => {
  assert.equal(kindOf(e('d', true)), 'dir')
  assert.equal(kindOf(e('p.png', false, 1, 0, 'png')), 'image')
  assert.equal(kindOf(e('m.ts', false, 1, 0, 'ts')), 'code')
  assert.equal(kindOf(e('x.qqq', false, 1, 0, 'qqq')), 'file')
  assert.equal(typeLabel(e('d', true)), 'پوشه')
  assert.equal(typeLabel(e('p.png', false, 1, 0, 'png')), 'تصویر')
  assert.equal(typeLabel(e('x.qqq', false, 1, 0, 'qqq')), 'QQQ', 'unknown extensions show themselves')
  assert.equal(typeLabel(e('noext', false, 1, 0, '')), 'فایل')
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

test('orderEntries: live filter keeps the sort', () => {
  const list = [e('zdir', true), e('file10', false, 5), e('file2', false, 5), e('other', false, 9)]
  assert.deepEqual(
    orderEntries(list, 'name', true, 'file').map((x) => x.name),
    ['file2', 'file10']
  )
  assert.deepEqual(
    orderEntries(list, 'name', true, '  FILE  ').map((x) => x.name),
    ['file2', 'file10'],
    'filter is trimmed and case-insensitive'
  )
  assert.equal(orderEntries(list, 'name', true, '').length, 4)
  assert.equal(orderEntries(list, 'name', true, 'nothing').length, 0)
})

test('planRename: template numbering with padding', () => {
  const out = planRename(['a.txt', 'b.jpg', 'noext'], {
    mode: 'template',
    template: 'photo-{nn}',
    find: '',
    replace: '',
    start: 3,
    pad: 3
  })
  assert.deepEqual(out, ['photo-003.txt', 'photo-004.jpg', 'photo-005'])
})

test('planRename: {name} and {ext} tokens', () => {
  assert.deepEqual(
    planRename(['holiday.png'], {
      mode: 'template',
      template: '{name}-small.{ext}',
      find: '',
      replace: '',
      start: 1,
      pad: 2
    }),
    ['holiday-small.png']
  )
})

test('planRename: regex groups, and an invalid pattern renames nothing', () => {
  assert.deepEqual(
    planRename(['IMG_1234.jpg'], {
      mode: 'regex',
      template: '',
      find: 'IMG_(\\d+)',
      replace: 'photo-$1',
      start: 1,
      pad: 2
    }),
    ['photo-1234.jpg']
  )
  assert.deepEqual(
    planRename(['a.txt'], { mode: 'regex', template: '', find: '(', replace: 'x', start: 1, pad: 2 }),
    ['a.txt']
  )
})

test('dirOf / joinPath keep the platform separator', () => {
  assert.equal(dirOf('/home/maxv/a.txt'), '/home/maxv')
  assert.equal(dirOf('/a'), '/')
  assert.equal(dirOf('C:\\x\\y.txt'), 'C:\\x')
  assert.equal(joinPath('/a/b', 'c.txt'), '/a/b/c.txt')
  assert.equal(joinPath('/a/b/', 'c.txt'), '/a/b/c.txt')
  assert.equal(joinPath('C:\\a', 'c.txt'), 'C:\\a\\c.txt')
})

test('groupLabel prefers the duplicate group number', () => {
  assert.equal(groupLabel({ ...e('x.txt', false, 1, 0, 'txt'), group: 2 }), 'گروه ۲')
  assert.equal(groupLabel(e('d', true)), 'پوشه')
})
