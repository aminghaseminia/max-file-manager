import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRemoteFs, RemoteError } from './remote-core.ts'
import { xmlEscape, type S3Config } from './s3.ts'

const objects = new Map<string, { body: Buffer; mtime: Date }>()

function signed(req: IncomingMessage): boolean {
  return String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256 ')
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const parts = url.pathname.replace(/^\/+/, '').split('/')
  const bucket = parts.shift() ?? ''
  const key = decodeURIComponent(parts.join('/'))
  if (!signed(req) || bucket !== 'photos') {
    res.writeHead(403, { 'content-type': 'application/xml' })
    res.end('<Error><Code>AccessDenied</Code><Message>nope</Message></Error>')
    return
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = Buffer.concat(chunks)
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
    res.writeHead(200)
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
    for (const m of body.toString('utf8').matchAll(/<Key>([\s\S]*?)<\/Key>/g)) {
      objects.delete(
        m[1]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
      )
    }
    res.writeHead(200, { 'content-type': 'application/xml' })
    res.end('<DeleteResult/>')
    return
  }
  res.writeHead(405)
  res.end()
}

test('the remote filesystem drives a real S3-compatible HTTP server', async (t) => {
  const server = createServer((req, res) => void handle(req, res))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const endpoint = `http://127.0.0.1:${port}`
  const cfg: S3Config = {
    bucket: 'photos',
    region: 'us-east-1',
    endpoint,
    pathStyle: true,
    accessKey: 'AKIATEST',
    secretKey: 'secret',
    verifyTls: false
  }
  const rfs = createRemoteFs(async () => ({ id: 'test', name: 'test', config: { protocol: 's3', ...cfg } }))
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-rc-'))
  t.after(async () => {
    server.close()
    objects.clear()
    await fs.rm(temp, { recursive: true, force: true })
  })

  const root = 's3://photos/'
  assert.deepEqual((await rfs.list(root, true)).entries, [])

  await rfs.mkdir('s3://photos/docs')
  await rfs.writeBuffer('s3://photos/docs/a.txt', Buffer.from('hello world'))
  await rfs.mkdir('s3://photos/docs/sub')
  await rfs.writeText('s3://photos/docs/sub/b.txt', 'bee')

  const top = await rfs.list(root, true)
  assert.deepEqual(top.entries.map((e) => [e.name, e.dir]), [['docs', true]])
  const docs = await rfs.list('s3://photos/docs', true)
  assert.deepEqual(docs.entries.map((e) => [e.name, e.dir, e.size]), [
    ['sub', true, 0],
    ['a.txt', false, 11]
  ])
  assert.deepEqual((await rfs.dirs('s3://photos/docs', true)).map((d) => d.name), ['sub'])

  const st = await rfs.stat('s3://photos/docs/a.txt')
  assert.equal(st?.dir, false)
  assert.equal(st?.size, 11)
  assert.equal((await rfs.stat('s3://photos/docs'))?.dir, true)
  assert.equal(await rfs.stat('s3://photos/nope'), null)

  const read = await rfs.readText('s3://photos/docs/a.txt')
  assert.equal('text' in read ? read.text : '', 'hello world')
  const props = await rfs.properties('s3://photos/docs')
  assert.equal(props.remote, true)
  assert.equal(props.dir, true)
  assert.equal(props.items, 2)

  const measured = await rfs.measure('s3://photos/docs')
  assert.deepEqual(measured, { bytes: 14, files: 2, capped: false })

  const local = path.join(temp, 'down.txt')
  await rfs.downloadFile('s3://photos/docs/a.txt', local)
  assert.equal(await fs.readFile(local, 'utf8'), 'hello world')

  const upload = path.join(temp, 'up.txt')
  await fs.writeFile(upload, 'uploaded')
  await rfs.uploadFile(upload, 's3://photos/docs/c.txt')
  assert.equal((await rfs.stat('s3://photos/docs/c.txt'))?.size, 8)

  const free = await rfs.freeName('s3://photos/docs/a.txt')
  assert.equal(free, 's3://photos/docs/a%20%282%29.txt')
  assert.equal(await rfs.exists('s3://photos/docs/a.txt'), true)

  await rfs.rename('s3://photos/docs/a.txt', 's3://photos/docs/z.txt')
  assert.equal(await rfs.exists('s3://photos/docs/a.txt'), false)
  assert.equal(await rfs.exists('s3://photos/docs/z.txt'), true)
  await assert.rejects(
    async () => rfs.rename('s3://photos/docs/z.txt', 's3://photos/docs/c.txt'),
    (e: unknown) => e instanceof RemoteError && e.code === 'exists'
  )

  await rfs.remove('s3://photos/docs/sub')
  assert.equal(await rfs.exists('s3://photos/docs/sub'), false)
  await rfs.remove('s3://photos/docs')
  assert.equal(await rfs.exists('s3://photos/docs'), false)
})

test('a password in a remote path is refused before any connection', async () => {
  const rfs = createRemoteFs(async () => {
    throw new Error('must not resolve')
  })
  await assert.rejects(
    () => rfs.list('ftp://user:secret@example.com/', true),
    (e: unknown) => e instanceof RemoteError && e.code === 'password_in_url'
  )
  await assert.rejects(
    () => rfs.list('s3://photos/', true),
    (e: unknown) => e instanceof Error && e.message === 'must not resolve'
  )
})
