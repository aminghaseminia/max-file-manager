import { app, nativeImage } from 'electron'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

/** Thumbnails are cached on disk keyed by path + mtime + size, so a second visit is instant. */
const MAX_FILES = 4000
const MAX_BYTES = 300 * 1024 * 1024
const MAX_SIDE = 512

let dir: string | null = null
let writes = 0

function cacheDir(): string {
  if (!dir) dir = path.join(app.getPath('userData'), 'thumbs')
  return dir
}

export function thumbKey(p: string, mtime: number, size: number, side: number): string {
  return createHash('sha1').update(`${p}|${mtime}|${size}|${side}`).digest('hex') + '.png'
}

async function prune(): Promise<void> {
  const d = cacheDir()
  const names = await fs.readdir(d).catch(() => [] as string[])
  if (names.length <= MAX_FILES) {
    // cheap size check only every so often
    if (writes % 200 !== 0) return
  }
  const stats: { file: string; at: number; size: number }[] = []
  for (const f of names) {
    const st = await fs.stat(path.join(d, f)).catch(() => null)
    if (st) stats.push({ file: f, at: st.mtimeMs, size: st.size })
  }
  let total = stats.reduce((n, s) => n + s.size, 0)
  if (stats.length <= MAX_FILES && total <= MAX_BYTES) return
  stats.sort((a, b) => a.at - b.at)
  let count = stats.length
  for (const s of stats) {
    if (count <= MAX_FILES && total <= MAX_BYTES) break
    await fs.rm(path.join(d, s.file), { force: true })
    total -= s.size
    count--
  }
}

/** Returns the cached thumbnail path, generating it when needed. `null` = not an image. */
export async function thumbFor(p: string, side = 256): Promise<string | null> {
  if (!path.isAbsolute(p)) return null
  const st = await fs.stat(p).catch(() => null)
  if (!st || st.isDirectory() || st.size === 0) return null
  const capped = Math.min(MAX_SIDE, Math.max(32, side))
  const d = cacheDir()
  const file = path.join(d, thumbKey(p, st.mtimeMs, st.size, capped))
  const hit = await fs.stat(file).catch(() => null)
  if (hit) {
    // touch so the LRU keeps what is actually used
    const now = new Date()
    await fs.utimes(file, now, now).catch(() => {})
    return file
  }
  const img = nativeImage.createFromPath(p)
  if (img.isEmpty()) return null
  const size = img.getSize()
  const scale = Math.max(size.width, size.height) > capped ? capped / Math.max(size.width, size.height) : 1
  const out =
    scale < 1
      ? img.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'good'
        })
      : img
  await fs.mkdir(d, { recursive: true }).catch(() => {})
  await fs.writeFile(file, out.toPNG()).catch(() => null)
  if (++writes % 50 === 0) void prune()
  return file
}

/** Clears the cache (Preferences → پیشرفته offers this). */
export async function clearThumbs(): Promise<{ removed: number }> {
  const d = cacheDir()
  const names = await fs.readdir(d).catch(() => [] as string[])
  let removed = 0
  for (const f of names) {
    await fs.rm(path.join(d, f), { force: true }).catch(() => null)
    removed++
  }
  return { removed }
}
