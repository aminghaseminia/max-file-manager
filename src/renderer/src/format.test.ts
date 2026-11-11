import assert from 'node:assert/strict'
import { setLang } from './i18n.ts'
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
  modeString,
  navIndex,
  opensInEditor,
  orderEntries,
  permLevel,
  permMode,
  planRename,
  sortEntries,
  toJalali,
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
  setLang('fa')
  assert.equal(fa(2026), '۲۰۲۶')
  assert.equal(fa('a1b2'), 'a۱b۲')
})

test('fmtSize in Persian', () => {
  setLang('fa')
  assert.equal(fmtSize(0, false), '۰ بایت')
  assert.equal(fmtSize(999, false), '۹۹۹ بایت')
  assert.equal(fmtSize(1024, false), '۱٫۰ کیلوبایت')
  assert.equal(fmtSize(1536, false), '۱٫۵ کیلوبایت')
  assert.equal(fmtSize(1048576, false), '۱٫۰ مگابایت')
  assert.equal(fmtSize(12345678, false), '۱۲ مگابایت')
  assert.equal(fmtSize(5000, true), '', 'folders report nothing unless computed')
})

test('fmtDate: padded and Persian', () => {
  setLang('fa')
  assert.equal(fmtDate(0), '')
  assert.match(fmtDate(Date.UTC(2026, 0, 2, 3, 4)), /^[۰-۹]{4}-[۰-۹]{2}-[۰-۹]{2} [۰-۹]{2}:[۰-۹]{2}$/)
})

test('the same helpers read as English when the language is English', () => {
  setLang('en')
  assert.equal(fa(2026), '2026')
  assert.equal(fmtSize(0, false), '0 B')
  assert.match(fmtDate(Date.UTC(2024, 2, 20, 9, 5), 'iso'), /^2024-03-20 \d{2}:\d{2}$/)
  setLang('fa')
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
  setLang('fa')
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
  setLang('fa')
  assert.equal(groupLabel({ ...e('x.txt', false, 1, 0, 'txt'), group: 2 }), 'گروه ۲')
  assert.equal(groupLabel(e('d', true)), 'پوشه')
})

test('sortEntries: foldersFirst=false mixes folders into the order', () => {
  const list = [e('zdir', true), e('a.txt', false), e('bfile', false)]
  assert.deepEqual(sortEntries(list, 'name', true, false).map((x) => x.name), ['a.txt', 'bfile', 'zdir'])
  assert.deepEqual(sortEntries(list, 'name', true).map((x) => x.name), ['zdir', 'a.txt', 'bfile'])
})

test('toJalali: Nowruz 1403 is 2024-03-20', () => {
  assert.deepEqual(toJalali(Date.UTC(2024, 2, 20, 12)), [1403, 1, 1])
  assert.deepEqual(toJalali(Date.UTC(2024, 2, 21, 12)), [1403, 1, 2])
})

test('fmtDate honours the format setting', () => {
  const t = Date.UTC(2024, 2, 20, 9, 5, 7)
  assert.match(fmtDate(t, 'jalali'), /^۱۴۰۳-۰۱-۰۱/)
  assert.match(fmtDate(t, 'short'), /^[۰-۹]{2}:[۰-۹]{2}$/)
  assert.match(fmtDate(t, 'short', true), /^[۰-۹]{2}:[۰-۹]{2}:[۰-۹]{2}$/)
})

test('fmtSize can print exact bytes', () => {
  assert.equal(fmtSize(1536, false, 'bytes'), '۱۵۳۶ بایت')
  assert.equal(fmtSize(1536, false), '۱٫۵ کیلوبایت')
})

test('modeString', () => {
  assert.equal(modeString(0o755), 'rwxr-xr-x')
  assert.equal(modeString(0o644), 'rw-r--r--')
  assert.equal(modeString(0o000), '---------')
})

test('the #token in the filter matches labels, not names', () => {
  const entries = [
    { name: 'a.txt', path: '/x/a.txt', dir: false, size: 1, mtime: 1, ext: 'txt' },
    { name: 'b.txt', path: '/x/b.txt', dir: false, size: 1, mtime: 1, ext: 'txt' },
    { name: 'c-red.txt', path: '/x/c-red.txt', dir: false, size: 1, mtime: 1, ext: 'txt' }
  ]
  const labels = { 'a.txt': 'red', 'b.txt': 'blue' }
  assert.deepEqual(
    orderEntries(entries, 'name', true, '#red', true, undefined, labels).map((e) => e.name),
    ['a.txt']
  )
  assert.deepEqual(
    orderEntries(entries, 'name', true, '#blu', true, undefined, labels).map((e) => e.name),
    ['b.txt'],
    'partial label ids match'
  )
  assert.deepEqual(
    orderEntries(entries, 'name', true, '#nothing', true, undefined, labels).map((e) => e.name),
    []
  )
  assert.equal(
    orderEntries(entries, 'name', true, 'red', true, undefined, labels).length,
    1,
    'without # it stays a name filter'
  )
})

test('navIndex: list steps one row, clamps at both ends', () => {
  assert.equal(navIndex(-1, 'down', 5), 0, 'nothing selected starts at the top')
  assert.equal(navIndex(0, 'up', 5), 0, 'up from the top stays put')
  assert.equal(navIndex(2, 'down', 5), 3)
  assert.equal(navIndex(4, 'down', 5), 4)
  assert.equal(navIndex(2, 'first', 5), 0)
  assert.equal(navIndex(2, 'last', 5), 4)
  assert.equal(navIndex(-1, 'last', 5), 4)
  assert.equal(navIndex(0, 'down', 0), -1, 'an empty list has no cursor')
})

test('navIndex: grid steps a whole row and a whole page', () => {
  // 10 columns, 3 visible rows: 30 items
  assert.equal(navIndex(2, 'down', 30, 10, 3), 12)
  assert.equal(navIndex(12, 'up', 30, 10, 3), 2)
  assert.equal(navIndex(2, 'right', 30, 10, 3), 3)
  assert.equal(navIndex(2, 'left', 30, 10, 3), 1)
  assert.equal(navIndex(2, 'pageDown', 30, 10, 3), 29, 'clamped to the last item')
  assert.equal(navIndex(22, 'pageUp', 30, 10, 3), 0, 'a page up from row 3 lands on the first row')
  assert.equal(navIndex(24, 'pageUp', 30, 10, 3), 0, 'clamped to the first item')
})

test('opensInEditor: text and extensionless files, never folders or binaries', () => {
  assert.equal(opensInEditor(e('notes.txt', false, 10, 0, 'txt')), true)
  assert.equal(opensInEditor(e('README', false, 10, 0, '')), true)
  assert.equal(opensInEditor(e('post.md', false, 10, 0, 'md')), true)
  assert.equal(opensInEditor(e('photo.png', false, 10, 0, 'png')), false)
  assert.equal(opensInEditor(e('archive.zip', false, 10, 0, 'zip')), false)
  assert.equal(opensInEditor(e('folder', true, 0, 0, '')), false)
})

test('permLevel: reads the three classes out of a mode', () => {
  assert.equal(permLevel(0o644, 0), 'rw')
  assert.equal(permLevel(0o644, 1), 'r')
  assert.equal(permLevel(0o644, 2), 'r')
  assert.equal(permLevel(0o600, 2), 'none')
  assert.equal(permLevel(0o777, 1), 'rw')
})

test('permMode: files keep their execute bit, folders follow read with x', () => {
  assert.equal(permMode(0o644, 2, 'rw', false), 0o646)
  assert.equal(permMode(0o644, 0, 'r', false), 0o444)
  assert.equal(permMode(0o755, 0, 'rw', false), 0o755, 'write does not clear x on a file')
  assert.equal(permMode(0o644, 1, 'rw', false), 0o664)
  assert.equal(permMode(0o755, 0, 'r', true), 0o555, 'a folder keeps x with read')
  assert.equal(permMode(0o755, 1, 'rw', true), 0o775)
  assert.equal(permMode(0o755, 2, 'none', true), 0o750)
})
