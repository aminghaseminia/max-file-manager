import { createHash, createHmac } from 'node:crypto'

/**
 * AWS Signature Version 4 for S3 — implemented here instead of pulling the whole AWS SDK into a
 * desktop app. The request is described by its already-encoded path and a plain query map, not by
 * a `URL`: the WHATWG parser resolves `.`/`..` even for S3, and an object key is opaque data.
 *
 * Every function in this file is pure apart from `node:crypto`, so the documented AWS vectors can
 * run under `node --test` without electron or a network.
 */
export type SigV4Input = {
  method: string
  /** `host` or `host:port` exactly as it goes on the wire. */
  host: string
  /** URL path, already encoded by `encodeS3Path` (may contain any UTF-8 data as %XX). */
  path: string
  query?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string | undefined>
  /** hex sha256, or `UNSIGNED-PAYLOAD` */
  payloadHash?: string
  region: string
  accessKey: string
  secretKey: string
  sessionToken?: string
  service?: string
  now?: Date
}

export type SigV4Result = {
  authorization: string
  amzDate: string
  dateStamp: string
  contentSha256: string
  signedHeaders: string
  canonicalRequest: string
  stringToSign: string
  signature: string
  /** encoded query string; the caller appends exactly this (or nothing) */
  queryString: string
  /** every header that must be sent, including host/date/token/authorization */
  headers: Record<string, string>
}

/** AWS's URI encoding: every byte except `A-Z a-z 0-9 - _ . ~`, slash optional. */
export function awsUriEncode(input: string, encodeSlash = true): string {
  const encoded = encodeURIComponent(String(input ?? '')).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
  return encodeSlash ? encoded : encoded.replace(/%2F/g, '/')
}

/** Encode an S3 key for a request path; slashes stay separators. */
export function encodeS3Path(key: string): string {
  return String(key ?? '')
    .split('/')
    .map((seg) => awsUriEncode(seg, true))
    .join('/')
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest()

function dateStamps(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export function canonicalQueryString(query: Record<string, string | number | boolean | undefined> = {}): string {
  return Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [awsUriEncode(k), awsUriEncode(String(v))] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

/** Canonical headers + the matching SignedHeaders line. */
export function canonicalHeaders(headers: Record<string, string | undefined>): {
  canonical: string
  signedHeaders: string
} {
  const pairs = Object.entries(headers)
    .filter(([k, v]) => v !== undefined && v !== null && k.toLowerCase() !== 'authorization')
    .map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/ +/g, ' ')] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return {
    canonical: pairs.map(([k, v]) => `${k}:${v}\n`).join(''),
    signedHeaders: pairs.map(([k]) => k).join(';')
  }
}

export function signV4(input: SigV4Input): SigV4Result {
  const service = input.service ?? 's3'
  const { amzDate, dateStamp } = dateStamps(input.now ?? new Date())
  const contentSha256 = input.payloadHash || EMPTY_SHA256
  const headers: Record<string, string> = {
    host: input.host,
    'x-amz-content-sha256': contentSha256,
    'x-amz-date': amzDate
  }
  for (const [k, v] of Object.entries(input.headers ?? {})) {
    if (v !== undefined && v !== null && k.toLowerCase() !== 'authorization') headers[k] = String(v)
  }
  if (input.sessionToken) headers['x-amz-security-token'] = input.sessionToken

  const queryString = canonicalQueryString(input.query)
  const canonicalUri = input.path.startsWith('/') ? input.path : '/' + input.path
  const { canonical, signedHeaders } = canonicalHeaders(headers)
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri,
    queryString,
    canonical,
    signedHeaders,
    contentSha256
  ].join('\n')

  const scope = `${dateStamp}/${input.region || 'us-east-1'}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const kDate = hmac(`AWS4${input.secretKey}`, dateStamp)
  const kRegion = hmac(kDate, input.region || 'us-east-1')
  const kService = hmac(kRegion, service)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    authorization,
    amzDate,
    dateStamp,
    contentSha256,
    signedHeaders,
    canonicalRequest,
    stringToSign,
    signature,
    queryString,
    headers: { ...headers, Authorization: authorization }
  }
}
