import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { IncomingHttpHeaders, IncomingMessage, ClientRequest, OutgoingHttpHeaders } from 'node:http'
import { EMPTY_SHA256, awsUriEncode, encodeS3Path, signV4 } from './s3-sign.ts'

/**
 * A deliberately small S3 client: what a file manager needs (list, head, get, put, delete, copy,
 * mkdir) over the standard SigV4 API, with streaming transfers and no SDK dependency.
 *
 * Works with AWS and S3-compatible servers (MinIO, Ceph, Backblaze, Spaces) through `endpoint`,
 * `pathStyle` and `verifyTls`. Requests are built as raw host/path instead of WHATWG URLs so an
 * object key containing `..` or a double slash is never rewritten into a different key.
 */
export type S3Config = {
  bucket: string
  region: string
  endpoint?: string
  pathStyle?: boolean
  accessKey: string
  secretKey: string
  sessionToken?: string
  /** false for a self-signed certificate (the user opts in per profile) */
  verifyTls?: boolean
}

export type S3ObjectInfo = { key: string; size: number; mtime: number; etag?: string }
export type S3ListPage = {
  objects: S3ObjectInfo[]
  prefixes: string[]
  truncated: boolean
  nextToken: string
}

export type S3Control = {
  onBytes?: (n: number) => void
  /** polled between chunks */
  cancelled?: () => boolean
  paused?: () => boolean
  waitIfPaused?: () => Promise<void>
}

export class S3Error extends Error {
  code: string
  status: number
  region: string
  constructor(code: string, message: string, status = 0, region = '') {
    super(message || code)
    this.name = 'S3Error'
    this.code = code
    this.status = status
    this.region = region
  }
}

const MAX_XML = 16 * 1024 * 1024
/** single PUT is the documented S3 limit; multipart is out of scope for a desktop file manager */
const MAX_SINGLE_PUT = 5 * 1024 * 1024 * 1024
const BATCH_DELETE = 1000

const isHttp = (s: string): boolean => /^https?:\/\//i.test(s)

type Target = {
  protocol: 'http:' | 'https:'
  hostname: string
  port: number
  /** host[:port] as signed and sent */
  hostHeader: string
  /** already encoded, no query */
  path: string
  pathStyle: boolean
}

/** Split an endpoint into host/port; the bucket is added later as path or subdomain. */
function endpointParts(cfg: S3Config): { protocol: 'http:' | 'https:'; hostname: string; port: number; basePath: string; explicit: boolean; defaultPort: number } {
  const raw = (cfg.endpoint ?? '').trim()
  if (raw) {
    let u: URL
    try {
      u = new URL(isHttp(raw) ? raw : `https://${raw}`)
    } catch {
      throw new S3Error('InvalidEndpoint', `invalid S3 endpoint: ${raw}`)
    }
    const protocol = u.protocol === 'http:' ? 'http:' : 'https:'
    const defaultPort = protocol === 'http:' ? 80 : 443
    return {
      protocol,
      hostname: u.hostname,
      port: Number(u.port) || defaultPort,
      basePath: u.pathname.replace(/\/+$/, ''),
      explicit: true,
      defaultPort
    }
  }
  const region = (cfg.region || 'us-east-1').trim()
  const hostname = region === 'us-east-1' ? 's3.amazonaws.com' : `s3.${region}.amazonaws.com`
  return { protocol: 'https:', hostname, port: 443, basePath: '', explicit: false, defaultPort: 443 }
}

export function s3Target(cfg: S3Config, key: string): Target {
  const e = endpointParts(cfg)
  const bucket = String(cfg.bucket ?? '').trim()
  if (!bucket) throw new S3Error('NoBucket', 'S3 bucket is missing')
  // A custom endpoint is path-style unless the user asked for virtual-host buckets; AWS is the
  // opposite. This is the combination MinIO/Ceph expect out of the box.
  const pathStyle = cfg.pathStyle ?? e.explicit
  const keyEncoded = encodeS3Path(key)
  if (pathStyle) {
    const path = `${e.basePath}/${awsUriEncode(bucket, true)}${keyEncoded ? `/${keyEncoded}` : ''}`
    return {
      protocol: e.protocol,
      hostname: e.hostname,
      port: e.port,
      hostHeader: e.hostname + (e.port !== e.defaultPort ? `:${e.port}` : ''),
      path: path || '/',
      pathStyle
    }
  }
  return {
    protocol: e.protocol,
    hostname: `${bucket}.${e.hostname}`,
    port: e.port,
    hostHeader: `${bucket}.${e.hostname}` + (e.port !== e.defaultPort ? `:${e.port}` : ''),
    path: `${e.basePath}/${keyEncoded}` || '/',
    pathStyle
  }
}

type Prepared = {
  req: ClientRequest
  target: Target
  queryString: string
  headers: OutgoingHttpHeaders
}

type RequestOpts = {
  method: string
  key: string
  query?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string | undefined>
  payloadHash?: string
  contentLength?: number
}

function prepare(cfg: S3Config, opts: RequestOpts): Prepared {
  const target = s3Target(cfg, opts.key)
  const signed = signV4({
    method: opts.method,
    host: target.hostHeader,
    path: target.path,
    query: opts.query,
    headers: opts.headers,
    payloadHash: opts.payloadHash ?? EMPTY_SHA256,
    region: cfg.region || 'us-east-1',
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    sessionToken: cfg.sessionToken
  })
  const headers: OutgoingHttpHeaders = { ...signed.headers }
  if (opts.contentLength !== undefined) headers['content-length'] = opts.contentLength
  const fullPath = target.path + (signed.queryString ? `?${signed.queryString}` : '')
  const mod = target.protocol === 'http:' ? http : https
  const req = mod.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: opts.method,
    path: fullPath,
    headers,
    rejectUnauthorized: cfg.verifyTls !== false,
    timeout: 120_000
  })
  req.on('timeout', () => req.destroy(new Error('S3 request timed out')))
  return { req, target, queryString: signed.queryString, headers }
}

type Response = { status: number; headers: IncomingHttpHeaders; stream: IncomingMessage }

function waitResponse(req: ClientRequest): Promise<Response> {
  return new Promise((resolve, reject) => {
    const onResponse = (res: IncomingMessage): void => {
      req.removeListener('error', onError)
      // a connection error can still surface on the request after the response started; the
      // stream itself reports read failures during iteration, so this listener only prevents
      // an unhandled 'error' event from taking the main process down
      req.on('error', () => undefined)
      resolve({ status: res.statusCode ?? 0, headers: res.headers, stream: res })
    }
    const onError = (e: Error): void => {
      req.removeListener('response', onResponse)
      reject(e)
    }
    req.once('response', onResponse)
    req.once('error', onError)
  })
}

async function readText(stream: IncomingMessage, max = MAX_XML): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const buf = chunk as Buffer
    total += buf.length
    if (total > max) {
      stream.destroy()
      throw new S3Error('ResponseTooLarge', `S3 response is larger than ${max} bytes`)
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export const xmlEscape = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)
  return m ? decodeXmlEntities(m[1].trim()) : ''
}

function blocks(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1])
}

/** ListObjectsV2 response → a page. Exported because it is the part worth unit-testing. */
export function parseListObjectsXml(xml: string): S3ListPage {
  const objects: S3ObjectInfo[] = []
  for (const block of blocks(xml, 'Contents')) {
    const key = tag(block, 'Key')
    if (!key) continue
    const size = Number(tag(block, 'Size')) || 0
    const iso = tag(block, 'LastModified')
    const mtime = iso ? Date.parse(iso) || 0 : 0
    const etag = tag(block, 'ETag').replace(/^"|"$/g, '')
    objects.push({ key, size, mtime, etag })
  }
  const prefixes = blocks(xml, 'CommonPrefixes')
    .map((b) => tag(b, 'Prefix'))
    .filter(Boolean)
  return {
    objects,
    prefixes,
    truncated: /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml),
    nextToken: tag(xml, 'NextContinuationToken')
  }
}

export function s3Error(status: number, body: string, headers: IncomingHttpHeaders): S3Error {
  const code =
    tag(body, 'Code') ||
    (status === 403 ? 'AccessDenied' : status === 404 ? 'NoSuchKey' : status === 301 ? 'PermanentRedirect' : `HTTP${status}`)
  const message =
    tag(body, 'Message') ||
    (status === 403
      ? 'S3 rejected the credentials (AccessDenied)'
      : status === 404
        ? 'the key does not exist'
        : status === 301
          ? 'wrong region or endpoint for this bucket'
          : `S3 request failed with HTTP ${status}`)
  const region = tag(body, 'Region') || String(headers['x-amz-bucket-region'] ?? '')
  return new S3Error(code, message, status, region)
}

/** Fresh S3 list page; the caller loops with `nextToken`. */
export async function s3ListPage(
  cfg: S3Config,
  prefix: string,
  opts: { delimiter?: string; maxKeys?: number; token?: string } = {}
): Promise<S3ListPage> {
  const query: Record<string, string | number | undefined> = {
    'list-type': '2',
    prefix: prefix || undefined,
    delimiter: opts.delimiter,
    'max-keys': Math.min(1000, Math.max(1, opts.maxKeys ?? 1000)),
    'continuation-token': opts.token || undefined
  }
  const { req } = prepare(cfg, { method: 'GET', key: '', query })
  const resPromise = waitResponse(req)
  req.end()
  const res = await resPromise
  const body = await readText(res.stream)
  if (res.status !== 200) throw s3Error(res.status, body, res.headers)
  return parseListObjectsXml(body)
}

export async function s3List(
  cfg: S3Config,
  prefix: string,
  opts: { maxPages?: number; maxKeys?: number } = {}
): Promise<{ objects: S3ObjectInfo[]; prefixes: string[]; capped: boolean }> {
  const objects: S3ObjectInfo[] = []
  const prefixes: string[] = []
  let token = ''
  let pages = 0
  const maxPages = opts.maxPages ?? 50
  do {
    const page = await s3ListPage(cfg, prefix, {
      delimiter: '/',
      maxKeys: opts.maxKeys ?? 1000,
      token
    })
    objects.push(...page.objects)
    prefixes.push(...page.prefixes)
    token = page.nextToken
    pages++
    if (!page.truncated || !token) return { objects, prefixes, capped: false }
  } while (pages < maxPages)
  return { objects, prefixes, capped: true }
}

/** Every key under a prefix, recursively (no delimiter), capped so a huge bucket stays finite. */
export async function s3ListAll(
  cfg: S3Config,
  prefix: string,
  maxPages = 50
): Promise<{ objects: S3ObjectInfo[]; capped: boolean }> {
  const objects: S3ObjectInfo[] = []
  let token = ''
  let pages = 0
  do {
    const page = await s3ListPage(cfg, prefix, { maxKeys: 1000, token })
    objects.push(...page.objects)
    token = page.nextToken
    pages++
    if (!page.truncated || !token) return { objects, capped: false }
  } while (pages < maxPages)
  return { objects, capped: true }
}

export async function s3Head(cfg: S3Config, key: string): Promise<S3ObjectInfo | null> {
  const { req } = prepare(cfg, { method: 'HEAD', key })
  const resPromise = waitResponse(req)
  req.end()
  const res = await resPromise
  // HEAD has no body; drain whatever a broken server sends
  res.stream.resume()
  if (res.status === 404) return null
  if (res.status !== 200) throw s3Error(res.status, '', res.headers)
  const size = Number(res.headers['content-length'] ?? 0) || 0
  const mtime = Date.parse(String(res.headers['last-modified'] ?? '')) || 0
  const etag = String(res.headers.etag ?? '').replace(/^"|"$/g, '')
  return { key, size, mtime, etag }
}

/** True when `key` names a folder: a marker object, or any key under `key/`. */
export async function s3IsPrefix(cfg: S3Config, key: string): Promise<boolean> {
  const prefix = key ? key.replace(/\/+$/, '') + '/' : ''
  const page = await s3ListPage(cfg, prefix, { delimiter: '/', maxKeys: 1 })
  return page.objects.length > 0 || page.prefixes.length > 0
}

export async function s3Download(
  cfg: S3Config,
  key: string,
  dest: string,
  control: S3Control = {},
  maxBytes = 0
): Promise<{ size: number }> {
  const { req } = prepare(cfg, { method: 'GET', key })
  const resPromise = waitResponse(req)
  req.end()
  const res = await resPromise
  if (res.status !== 200) {
    const body = await readText(res.stream)
    throw s3Error(res.status, body, res.headers)
  }
  const tmp = `${dest}.part`
  const out = createWriteStream(tmp)
  let total = 0
  let failed = false
  try {
    for await (const chunk of res.stream) {
      const buf = chunk as Buffer
      if (control.cancelled?.()) {
        failed = true
        res.stream.destroy()
        throw new Error('cancelled')
      }
      if (control.paused?.()) await control.waitIfPaused?.()
      if (control.cancelled?.()) {
        failed = true
        res.stream.destroy()
        throw new Error('cancelled')
      }
      total += buf.length
      if (maxBytes && total > maxBytes) {
        failed = true
        res.stream.destroy()
        throw new S3Error('TooLarge', `file is larger than ${maxBytes} bytes`)
      }
      if (!out.write(buf)) await new Promise<void>((r) => out.once('drain', () => r()))
      control.onBytes?.(buf.length)
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve())
      out.once('error', reject)
    })
    await fs.rename(tmp, dest)
    return { size: total }
  } catch (e) {
    out.destroy()
    await fs.rm(tmp, { force: true })
    throw e
  } finally {
    if (failed) res.stream.destroy()
  }
}

async function putStream(
  cfg: S3Config,
  key: string,
  size: number,
  contentType: string,
  openStream: () => NodeJS.ReadableStream,
  control: S3Control = {}
): Promise<void> {
  if (size > MAX_SINGLE_PUT) throw new S3Error('TooLarge', 'S3 single PUT supports files up to 5 GB')
  const { req } = prepare(cfg, {
    method: 'PUT',
    key,
    headers: { 'content-type': contentType, 'cache-control': 'no-cache' },
    // HTTPS protects the body; signing a multi-gigabyte stream would require reading it twice
    payloadHash: 'UNSIGNED-PAYLOAD',
    contentLength: size
  })
  const resPromise = waitResponse(req)
  try {
    const stream = openStream()
    for await (const chunk of stream) {
      if (control.cancelled?.()) throw new Error('cancelled')
      if (control.paused?.()) await control.waitIfPaused?.()
      if (control.cancelled?.()) throw new Error('cancelled')
      const buf = chunk as Buffer
      if (!req.write(buf)) await new Promise<void>((r) => req.once('drain', () => r()))
      control.onBytes?.(buf.length)
    }
  } catch (e) {
    req.destroy()
    throw e
  }
  req.end()
  const res = await resPromise
  const body = await readText(res.stream)
  if (res.status < 200 || res.status >= 300) throw s3Error(res.status, body, res.headers)
}

export async function s3Upload(
  cfg: S3Config,
  key: string,
  localPath: string,
  control: S3Control = {}
): Promise<{ size: number }> {
  const st = await fs.stat(localPath)
  if (!st.isFile()) throw new S3Error('NotAFile', 'only regular files can be uploaded')
  await putStream(cfg, key, st.size, contentTypeOf(key), () => createReadStream(localPath), control)
  return { size: st.size }
}

export async function s3PutBuffer(
  cfg: S3Config,
  key: string,
  data: Buffer,
  contentType = 'application/octet-stream'
): Promise<void> {
  const { req } = prepare(cfg, {
    method: 'PUT',
    key,
    headers: { 'content-type': contentType },
    payloadHash: createHash('sha256').update(data).digest('hex'),
    contentLength: data.length
  })
  const resPromise = waitResponse(req)
  req.end(data)
  const res = await resPromise
  const body = await readText(res.stream)
  if (res.status < 200 || res.status >= 300) throw s3Error(res.status, body, res.headers)
}

/** Zero-byte marker object; the key must end with `/`. */
export async function s3Mkdir(cfg: S3Config, key: string): Promise<void> {
  const folder = key.replace(/\/+$/, '') + '/'
  await s3PutBuffer(cfg, folder, Buffer.alloc(0), 'application/x-directory')
}

export async function s3DeleteKeys(cfg: S3Config, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += BATCH_DELETE) {
    const slice = keys.slice(i, i + BATCH_DELETE)
    const body = Buffer.from(
      `<Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Quiet>false</Quiet>${slice
        .map((k) => `<Object><Key>${xmlEscape(k)}</Key></Object>`)
        .join('')}</Delete>`,
      'utf8'
    )
    const { req } = prepare(cfg, {
      method: 'POST',
      key: '',
      query: { delete: '' },
      headers: {
        'content-type': 'application/xml',
        'content-md5': createHash('md5').update(body).digest('base64')
      },
      payloadHash: createHash('sha256').update(body).digest('hex'),
      contentLength: body.length
    })
    const resPromise = waitResponse(req)
    req.end(body)
    const res = await resPromise
    const text = await readText(res.stream)
    if (res.status < 200 || res.status >= 300) throw s3Error(res.status, text, res.headers)
    const rejected = blocks(text, 'Error').map((b) => `${tag(b, 'Key')}: ${tag(b, 'Code')}`)
    if (rejected.length) throw new S3Error('DeleteFailed', rejected.slice(0, 5).join(', '), res.status)
  }
}

export async function s3DeleteObject(cfg: S3Config, key: string): Promise<void> {
  const { req } = prepare(cfg, { method: 'DELETE', key })
  const resPromise = waitResponse(req)
  req.end()
  const res = await resPromise
  const body = await readText(res.stream)
  if (res.status !== 204 && (res.status < 200 || res.status >= 300)) {
    throw s3Error(res.status, body, res.headers)
  }
}

/** Remove an object or everything under a folder prefix (marker included). */
export async function s3Remove(cfg: S3Config, key: string, recursive = true): Promise<void> {
  if (!recursive) {
    await s3DeleteObject(cfg, key)
    return
  }
  const prefix = key ? key.replace(/\/+$/, '') + '/' : ''
  const listed = await s3ListAll(cfg, prefix)
  if (listed.capped) throw new S3Error('TooManyObjects', 'the folder has too many objects to delete in one go')
  const keys = listed.objects.map((o) => o.key)
  // the folder's own marker (`key/`) is part of the listing; also try the bare key for odd servers
  if (key && !keys.includes(key)) keys.push(key)
  if (keys.length) await s3DeleteKeys(cfg, keys)
}

/** Server-side copy of one object. */
export async function s3CopyObject(cfg: S3Config, fromKey: string, toKey: string): Promise<void> {
  const source = `/${awsUriEncode(cfg.bucket)}/${encodeS3Path(fromKey)}`
  const { req } = prepare(cfg, {
    method: 'PUT',
    key: toKey,
    headers: { 'x-amz-copy-source': source }
  })
  const resPromise = waitResponse(req)
  req.end()
  const res = await resPromise
  const body = await readText(res.stream)
  if (res.status < 200 || res.status >= 300) throw s3Error(res.status, body, res.headers)
  if (/<Error>/.test(body)) throw s3Error(500, body, res.headers)
}

/** Copy every key under `from` to `to` (folder rename on S3). */
export async function s3CopyPrefix(cfg: S3Config, from: string, to: string): Promise<{ copied: number; capped: boolean }> {
  const fromPrefix = from.replace(/\/+$/, '') + '/'
  const toPrefix = to.replace(/\/+$/, '') + '/'
  const listed = await s3ListAll(cfg, fromPrefix)
  if (listed.capped) throw new S3Error('TooManyObjects', 'the folder has too many objects to copy in one go')
  for (const obj of listed.objects) {
    const target = toPrefix + obj.key.slice(fromPrefix.length)
    await s3CopyObject(cfg, obj.key, target)
  }
  return { copied: listed.objects.length, capped: listed.capped }
}

/** Cheap connectivity check used by the connection dialog. */
export async function s3Test(cfg: S3Config): Promise<{ ok: true; objects: number; prefixes: number }> {
  const page = await s3ListPage(cfg, '', { delimiter: '/', maxKeys: 1 })
  return { ok: true, objects: page.objects.length, prefixes: page.prefixes.length }
}

const MIME: Record<string, string> = {
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska'
}

export function contentTypeOf(name: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}
