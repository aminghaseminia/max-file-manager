/**
 * The one shape every cloud adapter exposes. It is deliberately the same surface the WebDAV
 * client already had, so `cloudOps`, the preview and the sync run never learn which provider they
 * are talking to.
 */
import { createWriteStream } from 'node:fs'
import type { ReadableStream as WebReadable } from 'node:stream/web'

export type CloudEntry = {
  name: string
  /** absolute provider path, used by the folder browser */
  path: string
  dir: boolean
  size: number
  mtime: number
  etag?: string
}

export type CloudStat = { size: number; mtime: number; dir: boolean; etag?: string }

export type CloudClient = {
  stat(p: string): Promise<CloudStat | null>
  list(p: string): Promise<CloudEntry[]>
  mkdir(p: string): Promise<void>
  createFolder(parent: string, name: string): Promise<string>
  remove(p: string): Promise<void>
  download(p: string, dest: string, onBytes?: (n: number) => void): Promise<void>
  upload(src: string, p: string, mtime?: number, onBytes?: (n: number) => void): Promise<void>
  test?(): Promise<{ ok: true; detail: string }>
}

export class CloudHttpError extends Error {
  status: number
  body: string
  constructor(status: number, body: string) {
    super(body || `HTTP ${status}`)
    this.name = 'CloudHttpError'
    this.status = status
    this.body = body
  }
}

/** Write a fetch body to a file with backpressure, reporting the bytes as they land. */
export async function writeBody(
  body: WebReadable<Uint8Array> | null,
  dest: string,
  onBytes?: (n: number) => void
): Promise<void> {
  if (!body) throw new CloudHttpError(502, 'the server sent no body')
  const out = createWriteStream(dest)
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      onBytes?.(value.byteLength)
      if (!out.write(Buffer.from(value))) {
        await new Promise<void>((r) => out.once('drain', () => r()))
      }
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()))
  }
}

export const encodePath = (p: string): string =>
  p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')

export const normPath = (p: string): string => {
  const clean = p.replace(/\/+$/, '')
  return clean || '/'
}

export const parentOf = (p: string): string => {
  const clean = normPath(p)
  if (clean === '/') return '/'
  const i = clean.lastIndexOf('/')
  return i <= 0 ? '/' : clean.slice(0, i)
}

export const nameOf = (p: string): string => {
  const clean = normPath(p)
  return clean === '/' ? '/' : clean.slice(clean.lastIndexOf('/') + 1)
}

/** Accept a 404 as «not there» instead of an error, for stat. */
export const isNotFound = (e: unknown): boolean => e instanceof CloudHttpError && e.status === 404
