import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parseListObjectsXml,
  S3Error,
  s3CopyObject,
  s3Download,
  s3Error,
  s3Head,
  s3List,
  s3ListAll,
  s3Mkdir,
  s3Remove,
  s3Target,
  s3Test,
  s3Upload,
  contentTypeOf,
  xmlEscape,
  type S3Config
} from './s3.ts'

const cfg = (endpoint: string): S3Config => ({
  bucket: 'photos',
  region: 'us-east-1',
  endpoint,
  accessKey: 'AKIATEST',
  secretKey: 'secret',
  verifyTls: false
})

test('ListObjectsV2 XML parses keys, entities, sizes, prefixes and pagination', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>photos</Name><Prefix>a/</Prefix><IsTruncated>true</IsTruncated>
  <NextContinuationToken>tok+1/2=</NextContinuationToken>
  <Contents><Key>a/one &amp; two.txt</Key><LastModified>2024-02-03T04:05:06.000Z</LastModified><Size>12</Size><ETag>&quot;abc&quot;</ETag></Contents>
  <Contents><Key>a/caf&#xE9;.jpg</Key><LastModified>2024-02-03T04:05:07.000Z</LastModified><Size>34</Size><ETag>"def"</ETag></Contents>
  <CommonPrefixes><Prefix>a/sub/</Prefix></CommonPrefixes>
</ListBucketResult>`
  const page = parseListObjectsXml(xml)
  assert.deepEqual(page.objects.map((o) => [o.key, o.size, o.mtime, o.etag]), [
    ['a/one & two.txt', 12, Date.parse('2024-02-03T04:05:06.000Z'), 'abc'],
    ['a/café.jpg', 34, Date.parse('2024-02-03T04:05:07.000Z'), 'def']
  ])
  assert.deepEqual(page.prefixes, ['a/sub/'])
  assert.equal(page.truncated, true)
  assert.equal(page.nextToken, 'tok+1/2=')
})

test('S3 targets: path style for custom endpoints, virtual host for AWS', () => {
  const custom = s3Target(cfg('http://127.0.0.1:9000'), 'a/b c.txt')
  assert.deepEqual(custom, {
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: 9000,
    hostHeader: '127.0.0.1:9000',
    path: '/photos/a/b%20c.txt',
    pathStyle: true
  })
  const aws = s3Target(
    { bucket: 'mybucket', region: 'eu-west-1', accessKey: 'a', secretKey: 's' },
    'dir/file.txt'
  )
  assert.equal(aws.hostname, 'mybucket.s3.eu-west-1.amazonaws.com')
  assert.equal(aws.hostHeader, 'mybucket.s3.eu-west-1.amazonaws.com')
  assert.equal(aws.path, '/dir/file.txt')
  assert.equal(aws.pathStyle, false)
  const base = s3Target(cfg('https://example.com/s3prefix'), 'x')
  assert.equal(base.path, '/s3prefix/photos/x')
})

test('S3 error XML becomes a typed error with the bucket region hint', () => {
  const err = s3Error(
    403,
    '<Error><Code>SignatureDoesNotMatch</Code><Message>bad signature</Message><Region>eu-central-1</Region></Error>',
    { 'x-amz-bucket-region': 'eu-central-1' }
  )
  assert.equal(err instanceof S3Error, true)
  assert.equal(err.code, 'SignatureDoesNotMatch')
  assert.equal(err.message, 'bad signature')
  assert.equal(err.region, 'eu-central-1')
  assert.equal(s3Error(404, '', {}).code, 'NoSuchKey')
  assert.equal(s3Error(301, '', { 'x-amz-bucket-region': 'us-west-1' }).region, 'us-west-1')
})

test('content types and delete XML escaping', () => {
  assert.equal(contentTypeOf('a.JPG'), 'image/jpeg')
  assert.equal(contentTypeOf('a.unknown'), 'application/octet-stream')
  assert.equal(xmlEscape('a&b<c>"d\''), 'a&amp;b&lt;c&gt;&quot;d&apos;')
})

test('end-to-end against a small S3-compatible server', async (t) => {
  const objects = new Map<string, { body: Buffer; mtime: Date }>()
  const server = createServer((req, res) => {
    void handle(req, res, objects)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const c = cfg(`http://127.0.0.1:${port}`)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-s3-'))
  t.after(async () => {
    server.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  await fs.writeFile(path.join(dir, 'upload.txt'), 'uploaded body')
  await s3Upload(c, 'folder/upload.txt', path.join(dir, 'upload.txt'))
  await s3Upload(c, 'folder/second.txt', path.join(dir, 'upload.txt'))
  await s3Mkdir(c, 'folder/nested')

  assert.equal((await s3Test(c)).ok, true)
  const head = await s3Head(c, 'folder/upload.txt')
  assert.equal(head?.size, 13)
  assert.ok((head?.mtime ?? 0) > 0)

  const listing = await s3List(c, 'folder/')
  assert.deepEqual(listing.objects.map((o) => o.key).sort(), ['folder/second.txt', 'folder/upload.txt'].sort())
  assert.deepEqual(listing.prefixes, ['folder/nested/'])

  const down = path.join(dir, 'downloaded.txt')
  const got = await s3Download(c, 'folder/upload.txt', down)
  assert.equal(got.size, 13)
  assert.equal(await fs.readFile(down, 'utf8'), 'uploaded body')

  await s3CopyObject(c, 'folder/upload.txt', 'folder/copy.txt')
  assert.equal(await fs.readFile(path.join(dir, 'upload.txt'), 'utf8'), 'uploaded body')
  assert.equal((await s3Head(c, 'folder/copy.txt'))?.size, 13)

  const all = await s3ListAll(c, 'folder/')
  assert.equal(all.objects.length, 4) // two files, the copy and the nested folder marker

  await s3Remove(c, 'folder')
  assert.equal(await s3Head(c, 'folder/upload.txt'), null)
  assert.equal(objects.size, 0)
})

/** Minimal subset of the S3 API the client actually speaks. */
async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  objects: Map<string, { body: Buffer; mtime: Date }>
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const parts = url.pathname.replace(/^\/+/, '').split('/')
  const bucket = parts.shift() ?? ''
  const key = decodeURIComponent(parts.join('/'))
  const auth = String(req.headers.authorization ?? '')
  if (!auth.startsWith('AWS4-HMAC-SHA256 ') || !auth.includes('/s3/aws4_request')) {
    res.writeHead(403, { 'content-type': 'application/xml' })
    res.end('<Error><Code>AccessDenied</Code><Message>not signed</Message></Error>')
    return
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = Buffer.concat(chunks)
  if (bucket !== 'photos') {
    res.writeHead(404)
    res.end()
    return
  }
  if (req.method === 'GET' && !key) {
    const prefix = url.searchParams.get('prefix') ?? ''
    const delimiter = url.searchParams.get('delimiter') ?? ''
    const entries = [...objects.entries()].filter(([k]) => k.startsWith(prefix))
    const contents = entries
      .filter(([k]) => !delimiter || (!k.slice(prefix.length).includes(delimiter) && !k.endsWith('/')))
      .map(
        ([k, v]) =>
          `<Contents><Key>${xmlEscape(k)}</Key><LastModified>${v.mtime.toISOString()}</LastModified><Size>${v.body.length}</Size><ETag>"e"</ETag></Contents>`
      )
      .join('')
    const prefixes = delimiter
      ? [
          ...new Set(
            entries
              .map(([k]) => k.slice(prefix.length))
              .filter((rel) => rel.includes(delimiter))
              .map((rel) => prefix + rel.slice(0, rel.indexOf(delimiter) + 1))
          )
        ]
          .map((p) => `<CommonPrefixes><Prefix>${xmlEscape(p)}</Prefix></CommonPrefixes>`)
          .join('')
      : ''
    res.writeHead(200, { 'content-type': 'application/xml' })
    res.end(`<ListBucketResult><IsTruncated>false</IsTruncated>${contents}${prefixes}</ListBucketResult>`)
    return
  }
  if (req.method === 'HEAD') {
    const hit = objects.get(key)
    if (!hit) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-length': String(hit.body.length), 'last-modified': hit.mtime.toUTCString(), etag: '"e"' })
    res.end()
    return
  }
  if (req.method === 'GET') {
    const hit = objects.get(key)
    if (!hit) {
      res.writeHead(404, { 'content-type': 'application/xml' })
      res.end('<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>')
      return
    }
    res.writeHead(200, { 'content-length': String(hit.body.length), 'content-type': 'text/plain' })
    res.end(hit.body)
    return
  }
  if (req.method === 'PUT') {
    const copyFrom = String(req.headers['x-amz-copy-source'] ?? '')
    if (copyFrom) {
      const source = decodeURIComponent(copyFrom.replace(/^\/+/, '').split('/').slice(1).join('/'))
      const hit = objects.get(source)
      if (!hit) {
        res.writeHead(404)
        res.end('<Error><Code>NoSuchKey</Code></Error>')
        return
      }
      objects.set(key, { body: hit.body, mtime: new Date() })
      res.writeHead(200, { 'content-type': 'application/xml' })
      res.end('<CopyObjectResult><ETag>"e"</ETag></CopyObjectResult>')
      return
    }
    objects.set(key, { body, mtime: new Date() })
    res.writeHead(200, { etag: '"e"' })
    res.end()
    return
  }
  if (req.method === 'DELETE') {
    objects.delete(key)
    res.writeHead(204)
    res.end()
    return
  }
  if (req.method === 'POST' && url.searchParams.has('delete')) {
    const xml = body.toString('utf8')
    for (const m of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) {
      objects.delete(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
    }
    res.writeHead(200, { 'content-type': 'application/xml' })
    res.end('<DeleteResult/>')
    return
  }
  res.writeHead(405)
  res.end()
}
