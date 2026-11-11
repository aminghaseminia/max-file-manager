import { promises as fs } from 'node:fs'
import path from 'node:path'
import { hashFile } from './hash.ts'
import { excluded } from './searchdb.ts'
import type { Entry } from './types.ts'

export type WalkOpts = {
  query?: string
  regex?: boolean
  content?: string
  minSize?: number
  maxSize?: number
  newerThan?: number
  includeDirs?: boolean
  /** matched entries to stop at */
  limit?: number
  /** names/paths to stay out of (node_modules, .git, …) */
  exclude?: string[]
  /** files to look at before giving up; keeps a home folder from blocking for minutes */
  maxScan?: number
  /** wall-clock budget; a search that would take longer stops and reports `capped` */
  budgetMs?: number
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
  const maxScan = o.maxScan ?? 200_000
  const deadline = Date.now() + (o.budgetMs ?? 4000)
  const skip = o.exclude ?? []
  const match = nameMatcher(o.query ?? '', !!o.regex)
  const needle = (o.content ?? '').trim().toLowerCase()
  const entries: Entry[] = []
  let scanned = 0
  let capped = false
  // breadth-first: shallow files (the ones people search for) are found before the deep tail
  const queue = [root]
  let head = 0

  while (head < queue.length) {
    if (Date.now() > deadline) {
      capped = true
      break
    }
    const dir = queue[head++]
    const kids = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const k of kids) {
      if (entries.length >= limit || scanned >= maxScan || Date.now() > deadline) {
        capped = true
        break
      }
      const p = path.join(dir, k.name)
      if (k.isDirectory()) {
        // never descend into node_modules/.git: that is where a home-folder search used to stall
        if (!excluded(p, skip)) queue.push(p)
        if (o.includeDirs && match(k.name)) entries.push(toEntry(root, p, true, 0, 0))
        continue
      }
      scanned++
      // the name test is free; only a match is worth a stat (this is what made search slow)
      if (!match(k.name)) continue
      const st = await fs.stat(p).catch(() => null)
      if (!st) continue
      if (o.minSize != null && st.size < o.minSize) continue
      if (o.maxSize != null && st.size > o.maxSize) continue
      if (o.newerThan != null && st.mtimeMs < o.newerThan) continue
      if (needle && !(await fileHas(p, needle, st.size))) continue
      entries.push(toEntry(root, p, false, st.size, st.mtimeMs))
    }
    if (capped) break
  }
  return { entries, scanned, capped }
}

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
