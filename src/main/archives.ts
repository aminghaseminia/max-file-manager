import { promises as fs, createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import { AsyncZipDeflate, Zip, gunzipSync, unzipSync } from 'fflate'
import { freeName } from './ops.ts'
import type { Entry } from './types.ts'

/** Archives are read whole into memory; beyond this the user gets a clear error instead of an OOM. */
export const ARCHIVE_CAP = 256 * 1024 * 1024

export type ZipLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

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
/** every file under a source, paired with the name it gets inside the archive */
async function collect(root: string): Promise<[string, string][]> {
  const out: [string, string][] = []
  const base = path.basename(root.replace(/[\\/]+$/, ''))
  const walk = async (abs: string, rel: string) => {
    const st = await fs.lstat(abs).catch(() => null)
    if (!st) return
    if (st.isDirectory()) {
      for (const k of await fs.readdir(abs)) await walk(path.join(abs, k), `${rel}/${k}`)
      return
    }
    out.push([abs, rel])
  }
  const st = await fs.lstat(root)
  if (st.isDirectory()) for (const k of await fs.readdir(root)) await walk(path.join(root, k), `${base}/${k}`)
  else out.push([root, base])
  return out
}

/**
 * Streams a zip into `dest/name`; nothing is held in memory except the current chunk.
 * shortcut: zip only (no 7z/rar/encryption), upgrade when those formats are actually needed.
 */
export async function createZip(
  dir: string,
  name: string,
  sources: string[],
  level: ZipLevel = 6
): Promise<{ path: string; files: number; bytes: number } | { error: string }> {
  if (!path.isAbsolute(dir)) return { error: 'مقصد نامعتبر است' }
  const out = await freeName(path.join(dir, name.toLowerCase().endsWith('.zip') ? name : `${name}.zip`))
  const files: [string, string][] = []
  try {
    for (const s of sources) {
      if (!path.isAbsolute(s)) return { error: 'مسیر نامعتبر' }
      files.push(...(await collect(s)))
    }
  } catch (e: any) {
    return { error: String(e?.message ?? e) }
  }
  if (!files.length) return { error: 'چیزی برای آرشیو کردن نیست' }

  const ws = createWriteStream(out)
  let failure: Error | null = null
  let writing = Promise.resolve()
  let resolveAll!: () => void
  let rejectAll!: (e: Error) => void
  const written = new Promise<void>((res, rej) => {
    resolveAll = res
    rejectAll = rej
  })
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      failure = err
      rejectAll(err)
      return
    }
    writing = writing.then(
      () =>
        new Promise<void>((res) => {
          if (ws.write(Buffer.from(chunk))) res()
          else ws.once('drain', () => res())
        })
    )
    // the stream is only complete once the last chunk has actually been written
    if (final) writing.then(resolveAll, rejectAll)
  })

  let bytes = 0
  try {
    for (const [abs, rel] of files) {
      if (failure) throw failure
      const entry = new AsyncZipDeflate(rel, { level })
      zip.add(entry)
      for await (const chunk of createReadStream(abs)) {
        const buf = chunk as Uint8Array
        bytes += buf.length
        entry.push(buf, false)
      }
      entry.push(new Uint8Array(0), true)
      await writing
    }
    zip.end()
    await written
    await new Promise<void>((res, rej) => {
      ws.on('error', rej)
      ws.end(() => res())
    })
  } catch (e: any) {
    ws.destroy()
    await fs.rm(out, { force: true })
    return { error: String(e?.message ?? e) }
  }
  return { path: out, files: files.length, bytes }
}

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
