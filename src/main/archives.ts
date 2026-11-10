import { gunzipSync, unzipSync } from 'fflate'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Entry } from './types.ts'

/** Archives are read whole into memory; beyond this the user gets a clear error instead of an OOM. */
export const ARCHIVE_CAP = 256 * 1024 * 1024

export const isArchive = (p: string): boolean => /\.(zip|tar|tgz|tar\.gz|tar\.bz2|tbz2)$/i.test(p)

type Item = { name: string; dir: boolean; size: number; mtime: number; data?: Uint8Array }

const extOf = (n: string) => {
  const b = n.split('/').pop() ?? n
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i + 1).toLowerCase() : ''
}

/** Minimal ustar/tar reader: names, sizes, mtimes, types. No pax/gnu long names. */
function readTar(buf: Buffer): Item[] {
  const items: Item[] = []
  let off = 0
  const str = (from: number, len: number) =>
    buf.subarray(from, from + len).toString('utf8').replace(/\0.*$/s, '')
  while (off + 512 <= buf.length) {
    const name = str(off, 100)
    if (!name) break
    const size = parseInt(str(off + 124, 12).trim() || '0', 8) || 0
    const mtime = (parseInt(str(off + 136, 12).trim() || '0', 8) || 0) * 1000
    const flag = str(off + 156, 1)
    const prefix = str(off + 345, 155)
    const full = prefix ? `${prefix}/${name}` : name
    const dir = flag === '5' || full.endsWith('/')
    const body = off + 512
    items.push({
      name: full.replace(/\/$/, ''),
      dir,
      size,
      mtime,
      data: dir ? undefined : buf.subarray(body, body + size)
    })
    off = body + Math.ceil(size / 512) * 512
  }
  return items
}

async function readItems(archive: string): Promise<Item[]> {
  const st = await fs.stat(archive)
  if (st.size > ARCHIVE_CAP) throw new Error('آرشیو برای مرور بزرگ‌تر از سقف ۲۵۶ مگابایت است')
  const buf = await fs.readFile(archive)
  const lower = archive.toLowerCase()
  if (lower.endsWith('.zip')) {
    const files = unzipSync(new Uint8Array(buf))
    return Object.entries(files).map(([name, data]) => ({
      name,
      dir: name.endsWith('/'),
      size: data.length,
      mtime: 0,
      data: name.endsWith('/') ? undefined : data
    }))
  }
  const tar = lower.endsWith('.tar') ? buf : gunzipSync(buf)
  return readTar(Buffer.from(tar))
}

/** Entries as a flat listing; `path` is `archive!inner/name` so a row can round-trip back here. */
export async function listArchive(archive: string): Promise<{ entries: Entry[]; capped: boolean }> {
  const items = await readItems(archive)
  const entries = items
    .filter((i) => i.name && !i.name.startsWith('__MACOSX'))
    .map<Entry>((i) => ({
      name: i.name,
      path: `${archive}!${i.name}`,
      dir: i.dir,
      size: i.size,
      mtime: i.mtime,
      ext: i.dir ? '' : extOf(i.name)
    }))
  return { entries, capped: false }
}

/** Writes the chosen inner paths (or everything when `names` is empty) under `dest`. */
export async function extract(
  archive: string,
  names: string[],
  dest: string
): Promise<{ done: number; errors: string[] }> {
  const errors: string[] = []
  let done = 0
  try {
    const items = await readItems(archive)
    const wanted = names.length ? new Set(names.map((n) => n.replace(/\/$/, ''))) : null
    for (const item of items) {
      if (wanted && !wanted.has(item.name.replace(/\/$/, ''))) continue
      const target = path.join(dest, item.name)
      try {
        if (!path.resolve(target).startsWith(path.resolve(dest))) throw new Error('مسیر بیرون از مقصد')
        if (item.dir) {
          await fs.mkdir(target, { recursive: true })
          continue
        }
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, item.data ?? new Uint8Array())
        done++
      } catch (e: any) {
        errors.push(`${item.name}: ${e?.message ?? String(e)}`)
      }
    }
  } catch (e: any) {
    errors.push(String(e?.message ?? e))
  }
  return { done, errors }
}
