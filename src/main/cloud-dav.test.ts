import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMultistatus, parseStat } from './cloud-dav.ts'

const XML = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/alice/Max/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getlastmodified>Mon, 10 Nov 2026 10:00:00 GMT</d:getlastmodified></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/Max/a%20b.txt</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>12</d:getcontentlength><d:getlastmodified>Mon, 10 Nov 2026 10:01:00 GMT</d:getlastmodified><d:getetag>&quot;abc123&quot;</d:getetag></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/Max/Sub/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/Max/Sub/deep.txt</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/Other.txt</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop></d:propstat>
  </d:response>
</d:multistatus>`

test('multistatus is parsed relative to the requested folder', () => {
  const rows = parseMultistatus(XML, '/remote.php/dav/files/alice/Max')
  // the folder itself is not a child, a deeper path and a sibling are not children either
  assert.deepEqual(
    rows.map((r) => r.name),
    ['a b.txt', 'Sub']
  )
  const file = rows[0]
  assert.equal(file.dir, false)
  assert.equal(file.size, 12)
  assert.equal(file.etag, 'abc123')
  assert.equal(file.path, '/remote.php/dav/files/alice/Max/a b.txt')
  assert.equal(Date.parse('Mon, 10 Nov 2026 10:01:00 GMT'), file.mtime)
  assert.equal(rows[1].dir, true)
})

test('an absolute href and a namespaced element still resolve', () => {
  const xml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>https://cloud.example/dav/x/F.txt</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>`
  const rows = parseMultistatus(xml, '/dav/x')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'F.txt')
})

test('a depth 0 response gives the resource itself', () => {
  const xml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/a/b/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`
  const st = parseStat(xml)
  assert.ok(st)
  assert.equal(st.dir, true)
  assert.equal(st.size, 0)
})

test('a response without any prop is not a resource', () => {
  assert.equal(parseStat('<d:multistatus xmlns:d="DAV:"/>'), null)
})
