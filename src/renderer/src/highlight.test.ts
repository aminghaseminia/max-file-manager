import assert from 'node:assert/strict'
import test from 'node:test'
import { dirOfText, hasRtl, RTL_CHAR_RX } from './direction.ts'
import { escapeHtml, highlightCode, langFor } from './highlight.ts'

test('hasRtl spots Persian/Arabic and ignores latin', () => {
  assert.equal(hasRtl('سلام دنیا'), true)
  assert.equal(hasRtl('hello world'), false)
  assert.equal(hasRtl('mixed سلام'), true)
  assert.equal(hasRtl(''), false)
  assert.equal(hasRtl(null), false)
  assert.equal(RTL_CHAR_RX.test('ع'), true)
})

test('dirOfText returns the direction a block must use', () => {
  assert.equal(dirOfText('خط اول'), 'rtl')
  assert.equal(dirOfText('const x = 1'), 'ltr')
  assert.equal(dirOfText('۱. لیست'), 'rtl', 'Persian digits count as RTL text')
})

test('langFor maps extensions and special file names', () => {
  assert.equal(langFor('/a/b/app.ts'), 'typescript')
  assert.equal(langFor('/a/b/app.tsx'), 'typescript')
  assert.equal(langFor('/a/b/main.py'), 'python')
  assert.equal(langFor('/a/b/Dockerfile'), 'dockerfile')
  assert.equal(langFor('/a/b/data.json'), 'json')
  assert.equal(langFor('/a/b/README.md'), 'markdown')
  assert.equal(langFor('/a/b/unknown.zzz'), null)
})

test('highlightCode colors real code and escapes plain text', () => {
  const js = highlightCode('const a = "x" // note', 'javascript')
  assert.match(js, /hljs-keyword/, 'keywords get a class')
  assert.match(js, /hljs-string/, 'strings get a class')

  const unknown = highlightCode('<script>alert(1)</script>', 'not-a-language')
  assert.equal(unknown, '&lt;script&gt;alert(1)&lt;/script&gt;', 'unknown languages are escaped, never raw')

  assert.equal(escapeHtml('a & b < c'), 'a &amp; b &lt; c')
})
