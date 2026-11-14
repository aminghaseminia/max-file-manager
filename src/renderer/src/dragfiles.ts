/**
 * Browser drop zones (web chats, upload fields) read `dataTransfer.files`, which a plain
 * `text/uri-list` drag never fills — Chromium keeps drags from other windows as text for
 * security. A real `File` has to be built from the bytes, and that must happen before
 * `dragstart` (the data store cannot be extended asynchronously), so a small cache is filled
 * on pointer-down/hover and read synchronously when the drag begins.
 */
import { api } from './api'

const MAX_FILE = 32 * 1024 * 1024
const MAX_TOTAL = 64 * 1024 * 1024
const MAX_ENTRIES = 12

type Cached = { key: string; file: File; bytes: Uint8Array; size: number }
const cache = new Map<string, Cached>()
let total = 0

const keyOf = (path: string, size: number, mtime: number) => `${path}\u0000${size}\u0000${mtime}`

function evict(): void {
  while (cache.size > MAX_ENTRIES || total > MAX_TOTAL) {
    const first = cache.keys().next().value as string | undefined
    if (!first) break
    const row = cache.get(first)
    if (row) total -= row.size
    cache.delete(first)
  }
}

/** Reads the file into memory once; a huge file is skipped instead of freezing the drag. */
export async function prefetchDragFile(
  path: string,
  name: string,
  size: number,
  mtime: number,
  max = MAX_FILE
): Promise<void> {
  if (!path || size <= 0 || size > max) return
  const key = keyOf(path, size, mtime)
  if (cache.has(key)) {
    // refresh LRU order
    const row = cache.get(key)!
    cache.delete(key)
    cache.set(key, row)
    return
  }
  const r = await api.readBytes(path, max).catch(() => null)
  if (!r || !r.data || !r.data.length) return
  // copy into a plain ArrayBuffer: a typed array from IPC is typed as ArrayBufferLike (SAB)
  const bytes = new Uint8Array(r.data)
  cache.set(key, { key, file: new File([bytes.buffer as ArrayBuffer], name), bytes, size })
  total += size
  evict()
}

/** The File to put on the drag, if this exact revision was prefetched. */
export function dragFileFor(path: string, size: number, mtime: number): File | null {
  const key = keyOf(path, size, mtime)
  const row = cache.get(key)
  if (!row) return null
  cache.delete(key)
  cache.set(key, row)
  return row.file
}

const MAX_DATA_URL = 4 * 1024 * 1024

function toBase64(bytes: Uint8Array): string {
  let raw = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    raw += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(raw)
}

/**
 * A `DownloadURL` carrying the bytes as a data URL. Chromium targets create a real File from
 * this (unlike a `file://` URL, which Chromium treats as a page navigation on drop).
 */
export function dragDownloadUrlFor(path: string, size: number, mtime: number): string | null {
  if (size > MAX_DATA_URL) return null
  const row = cache.get(keyOf(path, size, mtime))
  if (!row) return null
  return `data:application/octet-stream;base64,${toBase64(row.bytes)}`
}

/** Test seam only. */
export function clearDragFileCache(): void {
  cache.clear()
  total = 0
}
