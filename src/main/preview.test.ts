import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { hashFile, hashMany } from './hash.ts'
import { docxText, preview, xlsxSharedStrings, xlsxSheetText } from './preview.ts'

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'mfm-prev-'))

test('preview: text, binary, image, directory', async () => {
  const root = await tmp()
  const txt = path.join(root, 'a.txt')
  await fs.writeFile(txt, 'line one\nline two\n')
  const t = await preview(txt)
  assert.equal(t.kind, 'text')
  assert.match(t.text!, /line two/)
  assert.equal(t.size, 18)

  const bin = path.join(root, 'b.bin')
  await fs.writeFile(bin, Buffer.from([1, 0, 2, 3]))
  assert.equal((await preview(bin)).kind, 'binary', 'a NUL byte means binary, not text')

  const img = path.join(root, 'c.png')
  await fs.writeFile(img, Buffer.alloc(10))
  assert.equal((await preview(img)).kind, 'image')

  assert.equal((await preview(root)).kind, 'dir')
})

test('preview: long text is capped and says so', async () => {
  const root = await tmp()
  const big = path.join(root, 'big.log')
  await fs.writeFile(big, 'x'.repeat(300 * 1024))
  const p = await preview(big)
  assert.equal(p.kind, 'text')
  assert.equal(p.capped, true)
  assert.equal(p.text!.length, 200 * 1024)
})

test('hash: sha256 is stable and a missing file returns null', async () => {
  const root = await tmp()
  const f = path.join(root, 'x.txt')
  await fs.writeFile(f, 'hello')
  assert.equal(
    await hashFile(f),
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
  )
  assert.equal(await hashFile(path.join(root, 'nope')), null)
  const many = await hashMany([f, path.join(root, 'nope')])
  assert.equal(many.length, 2)
  assert.equal(many[1].hash, null)
})

test('docxText: paragraphs, table cells, entities — and none of the plumbing', () => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
    <w:p><w:r><w:t>سلام</w:t></w:r><w:r><w:t xml:space="preserve"> دنیا</w:t></w:r></w:p>
    <w:p><w:r><w:t>خط دوم</w:t><w:br/><w:t>ادامه</w:t></w:r></w:p>
    <w:tbl><w:tr>
      <w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc>
    </w:tr></w:tbl>
    <w:p><w:r><w:instrText>PAGE</w:instrText><w:delText>حذف</w:delText><w:t>&amp; &lt;x&gt;</w:t></w:r></w:p>
  </w:body></w:document>`

  const text = docxText(xml)

  assert.equal(text.includes('<w:'), false, 'no tags leak')
  assert.equal(text.includes('PAGE'), false, 'field codes are dropped')
  assert.equal(text.includes('حذف'), false, 'deleted text is dropped')
  assert.match(text, /سلام دنیا/)
  assert.match(text, /خط دوم\nادامه/, 'a hard break starts a new line')
  assert.match(text, /a\tb/, 'table cells are columns, not separate lines')
  assert.match(text, /& <x>/)
})

test('xlsx: shared strings are resolved and rows become tab-separated lines', () => {
  const shared = xlsxSharedStrings(
    '<sst><si><t>نام</t></si><si><r><t>مبل</t></r><r><t>غ</t></r></si></sst>'
  )
  assert.deepEqual(shared, ['نام', 'مبلغ'])
  const sheet =
    '<worksheet><sheetData>' +
    '<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>' +
    '<row><c><v>12</v></c><c><v>3400</v></c></row>' +
    '</sheetData></worksheet>'
  assert.equal(xlsxSheetText(sheet, shared), 'نام\tمبلغ\n12\t3400')
})
