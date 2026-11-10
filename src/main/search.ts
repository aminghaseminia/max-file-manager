import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import type { Entry } from './types.ts'

export type WalkOpts = {
  query?: string
  regex?: boolean
  content?: string
  minSize?: number
  maxSize?: number
  newerThan?: number
  includeDirs?: boolean
  limit?: number
}

/** Name test shared by flat view and search — exported so the rules are unit tested. */
export function nameMatcher(query: string, regex: boolean): (name: string) => boolean {
  if (!query) return () => true
  if (regex) {
    try {
      const re = new RegExp(query, 'i')
      return (n) => re.test(n)
    } catch {
      // an invalid pattern must not kill the search: fall through to a literal match
    }
  }
  if (/[*?]/.test(query)) {
    const rx = new RegExp(
      '^' +
        query.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') +
        '$',
      'i'
    )
    return (n) => rx.test(n)
  }
  const q = query.toLowerCase()
  return (n) => n.toLowerCase().includes(q)
}

const TEXT_CAP = 2 * 1024 * 1024

async function fileHas(p: string, needle: string, size: number): Promise<boolean> {
  if (size > TEXT_CAP) return false
  const buf = await fs.readFile(p).catch(() => null)
  if (!buf) return false
  if (buf.subarray(0, 4096).includes(0)) return false // binary: not worth pretending we searched it
  return buf.toString('utf8').toLowerCase().includes(needle)
}

const toEntry = (root: string, p: string, dir: boolean, size: number, mtime: number): Entry => ({
  name: path.relative(root, p),
  path: p,
  dir,
  size,
  mtime,
  ext: dir ? '' : path.extname(p).slice(1).toLowerCase()
})

// shortcut: breadth-first walk, no symlink cycles, stops at `limit`; upgrade with a real index when the whole disk must be searchable.
export async function walk(
  root: string,
  o: WalkOpts = {}
): Promise<{ entries: Entry[]; scanned: number; capped: boolean }> {
  const limit = o.limit ?? 5000
  const match = nameMatcher(o.query ?? '', !!o.regex)
  const needle = (o.content ?? '').trim().toLowerCase()
  const entries: Entry[] = []
  let scanned = 0
  let capped = false
  const stack = [root]

  while (stack.length) {
    const dir = stack.pop()!
    const kids = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const k of kids) {
      if (entries.length >= limit) {
        capped = true
        break
      }
      const p = path.join(dir, k.name)
      if (k.isDirectory()) {
        stack.push(p)
        if (o.includeDirs && match(k.name)) entries.push(toEntry(root, p, true, 0, 0))
        continue
      }
      scanned++
      const st = await fs.stat(p).catch(() => null)
      if (!st) continue
      if (o.minSize != null && st.size < o.minSize) continue
      if (o.maxSize != null && st.size > o.maxSize) continue
      if (o.newerThan != null && st.mtimeMs < o.newerThan) continue
      if (!match(k.name)) continue
      if (needle && !(await fileHas(p, needle, st.size))) continue
      entries.push(toEntry(root, p, false, st.size, st.mtimeMs))
    }
    if (capped) break
  }
  return { entries, scanned, capped }
}

const hashFile = (p: string): Promise<string | null> =>
  new Promise((resolve) => {
    const h = createHash('sha256')
    const rs = createReadStream(p)
    rs.on('data', (c) => h.update(c))
    rs.on('end', () => resolve(h.digest('hex')))
    rs.on('error', () => resolve(null))
  })

/** Files with identical size and sha256, tagged with a 1-based group number. */
export async function findDupes(
  root: string,
  o: { limit?: number } = {}
): Promise<{ entries: Entry[]; capped: boolean }> {
  const limit = o.limit ?? 4000
  const bySize = new Map<number, Entry[]>()
  let seen = 0
  let capped = false
  const stack = [root]

  while (stack.length) {
    const dir = stack.pop()!
    const kids = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const k of kids) {
      if (seen++ >= limit) {
        capped = true
        break
      }
      const p = path.join(dir, k.name)
      if (k.isDirectory()) {
        stack.push(p)
        continue
      }
      const st = await fs.stat(p).catch(() => null)
      if (!st || st.size === 0) continue
      const list = bySize.get(st.size) ?? []
      list.push(toEntry(root, p, false, st.size, st.mtimeMs))
      bySize.set(st.size, list)
    }
    if (capped) break
  }

  const entries: Entry[] = []
  let group = 0
  for (const sameSize of bySize.values()) {
    if (sameSize.length < 2) continue
    const byHash = new Map<string, Entry[]>()
    for (const e of sameSize) {
      const h = await hashFile(e.path)
      if (!h) continue
      const list = byHash.get(h) ?? []
      list.push(e)
      byHash.set(h, list)
    }
    for (const same of byHash.values()) {
      if (same.length < 2) continue
      group++
      for (const e of same) entries.push({ ...e, group })
    }
  }
  return { entries, capped }
}
