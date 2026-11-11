import assert from 'node:assert/strict'
import test from 'node:test'
import { rowsOf, toCsv, toHtmlTable } from './export.ts'

const rows = [
  { name: 'a,b.txt', size: 2048, mtime: 1_700_000_000_000, type: 'txt', label: 'قرمز', rating: 3, note: 'با "کوتیشن"' }
]

test('csv has a BOM, escapes quotes and commas, and keeps a header', () => {
  const csv = toCsv(rows)
  assert.equal(csv.charCodeAt(0), 0xfeff, 'BOM so Excel reads Persian')
  assert.match(csv, /name,size,modified,type,label,rating,note/)
  assert.match(csv, /"a,b\.txt"/, 'commas force quoting')
  assert.match(csv, /""کوتیشن""/, 'quotes are doubled')
})

test('html table escapes markup and shows stars', () => {
  const html = toHtmlTable([{ ...rows[0], name: '<script>x</script>' }], 'پوشه')
  assert.match(html, /&lt;script&gt;/, 'markup is escaped')
  assert.match(html, /★★★/, 'rating becomes stars')
  assert.match(html, /2\.0 KB/, 'size is humanised')
})

test('rowsOf joins entries with folder metadata', () => {
  const out = rowsOf(
    [
      { name: 'a.txt', path: '/x/a.txt', dir: false, size: 1, mtime: 1, ext: 'txt' },
      { name: 'sub', path: '/x/sub', dir: true, size: 0, mtime: 1, ext: '' }
    ],
    { labels: { 'a.txt': 'red' }, ratings: { 'a.txt': 5 }, notes: { sub: 'پوشهٔ مهم' } },
    (id) => (id === 'red' ? 'قرمز' : '')
  )
  assert.equal(out[0].label, 'قرمز')
  assert.equal(out[0].rating, 5)
  assert.equal(out[1].type, 'folder')
  assert.equal(out[1].note, 'پوشهٔ مهم')
})
