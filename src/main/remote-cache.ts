import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { RemoteFs } from './remote-core.ts'
import { remoteName } from '../shared/remote-path.ts'

/**
 * A disk cache for remote files the renderer needs as a local path: previews, the image viewer,
 * video, thumbnails and drag-out. The cache key includes the remote URI *and* the listing version
 * (mtime+size), so a changed remote file gets a new path and the browser's own image cache never
 * serves yesterday's picture.
 *
 * Files are pruned LRU-style; a failed download never leaves a half file behind.
 */
export type RemoteCache = ReturnType<typeof createRemoteCache>

const EXT_RE = /^[a-z0-9]{1,12}$/i

function cacheName(uri: string, version: string): string {
  const hash = createHash('sha1').update(`${uri}\u0000${version}`).digest('hex')
  const ext = /\.([A-Za-z0-9]{1,12})$/.exec(remoteName(uri))?.[1]?.toLowerCase() ?? ''
  return hash + (ext && EXT_RE.test(ext) ? `.${ext}` : '.bin')
}

export function createRemoteCache(opts: {
  dir: string
  fs: RemoteFs
  /** total cache budget */
  maxBytes?: number
  maxFiles?: number
  /** biggest single file this cache will materialize */
  maxFileBytes?: number
}) {
  const root = opts.dir
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024 * 1024
  const maxFiles = opts.maxFiles ?? 2000
  const maxFileBytes = opts.maxFileBytes ?? 512 * 1024 * 1024
  const inFlight = new Map<string, Promise<string>>()
  let writes = 0

  async function prune(): Promise<void> {
    writes++
    if (writes % 25 !== 0) return
    const names = await fs.readdir(root).catch(() => [] as string[])
    if (!names.length) return
    const entries: { file: string; at: number; size: number }[] = []
    for (const name of names) {
      const st = await fs.stat(path.join(root, name)).catch(() => null)
      if (st?.isFile()) entries.push({ file: name, at: st.mtimeMs, size: st.size })
    }
    let total = entries.reduce((n, e) => n + e.size, 0)
    if (entries.length <= maxFiles && total <= maxBytes) return
    entries.sort((a, b) => a.at - b.at)
    let count = entries.length
    for (const e of entries) {
      if (count <= maxFiles && total <= maxBytes) break
      await fs.rm(path.join(root, e.file), { force: true }).catch(() => undefined)
      total -= e.size
      count--
    }
  }

  async function ensure(uri: string, version = '', opts2: { maxBytes?: number } = {}): Promise<string> {
    const key = cacheName(uri, version)
    const dest = path.join(root, key)
    const existing = await fs.stat(dest).catch(() => null)
    if (existing?.isFile()) {
      // touch for LRU
      const now = new Date()
      await fs.utimes(dest, now, now).catch(() => undefined)
      return dest
    }
    const running = inFlight.get(dest)
    if (running) return running
    const job = (async () => {
      await fs.mkdir(root, { recursive: true })
      const st = await opts.fs.stat(uri)
      if (!st) throw new Error('remote file not found')
      if (st.dir) throw new Error('this is a folder')
      const cap = Math.min(maxFileBytes, opts2.maxBytes ?? maxFileBytes)
      if (st.size > cap) throw new Error(`file is larger than ${cap} bytes`)
      await opts.fs.downloadFile(uri, dest)
      const got = await fs.stat(dest).catch(() => null)
      if (!got?.isFile()) throw new Error('the remote file was not downloaded')
      void prune().catch(() => undefined)
      return dest
    })()
    inFlight.set(dest, job)
    try {
      return await job
    } finally {
      inFlight.delete(dest)
    }
  }

  async function clear(): Promise<void> {
    inFlight.clear()
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)
  }

  return { ensure, clear, root }
}
