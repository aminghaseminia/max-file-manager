import { promises as fs } from 'node:fs'
import path from 'node:path'

export type BreakdownMode = 'level1' | 'all'

export type Slice = { key: string; count: number; bytes: number }
export type LargeFile = { path: string; rel: string; name: string; ext: string; size: number }
export type ChildBucket = {
  path: string
  name: string
  dir: boolean
  bytes: number
  files: number
}
export type Breakdown = {
  root: string
  mode: BreakdownMode
  bytes: number
  files: number
  folders: number
  scanned: number
  capped: boolean
  /** extension ('' for no extension) → count and bytes */
  byExt: Slice[]
  /** the biggest files, largest first */
  largest: LargeFile[]
  /** what each direct child of the folder contributes */
  children: ChildBucket[]
}

export type BreakdownOpts = {
  mode?: BreakdownMode
  /** entries visited before giving up (files + folders) */
  maxEntries?: number
  /** wall-clock budget in ms */
  budgetMs?: number
  /** how many files the `largest` list keeps */
  topFiles?: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Aggregate what a folder contains: bytes and counts per extension, the largest files and how
 * much each direct child contributes. `level1` looks only at the folder itself; `all` walks the
 * whole tree. Both are bounded, and a capped scan says so instead of returning a quiet lie.
 */
export async function breakdown(root: string, o: BreakdownOpts = {}): Promise<Breakdown> {
  const mode: BreakdownMode = o.mode === 'level1' ? 'level1' : 'all'
  const maxEntries = clamp(Math.round(o.maxEntries ?? 250_000), 1_000, 2_000_000)
  const budgetMs = clamp(Math.round(o.budgetMs ?? 6_000), 200, 60_000)
  const topFiles = clamp(Math.round(o.topFiles ?? 15), 1, 200)
  const deadline = Date.now() + budgetMs

  let bytes = 0
  let files = 0
  let folders = 0
  let scanned = 0
  let capped = false

  const ext = new Map<string, Slice>()
  const children = new Map<string, ChildBucket>()
  const largest: LargeFile[] = []

  const addFile = (top: ChildBucket | null, p: string, size: number, extension: string) => {
    bytes += size
    files++
    if (top) {
      top.bytes += size
      top.files++
    }
    const e = ext.get(extension)
    if (e) {
      e.count++
      e.bytes += size
    } else ext.set(extension, { key: extension, count: 1, bytes: size })
    if (size <= 0) return
    if (largest.length >= topFiles && size <= (largest.at(-1)?.size ?? 0)) return
    const row: LargeFile = {
      path: p,
      rel: path.relative(root, p),
      name: path.basename(p),
      ext: extension,
      size
    }
    let at = largest.length
    while (at > 0 && largest[at - 1].size < size) at--
    largest.splice(at, 0, row)
    if (largest.length > topFiles) largest.length = topFiles
  }

  // one queue for both modes: `level1` simply never enqueues a child folder
  const queue: { dir: string; top: ChildBucket | null }[] = [{ dir: root, top: null }]
  let head = 0
  while (head < queue.length) {
    const { dir, top } = queue[head++]
    if (Date.now() > deadline || scanned >= maxEntries) {
      capped = true
      break
    }
    const kids = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const k of kids) {
      if (Date.now() > deadline || scanned >= maxEntries) {
        capped = true
        break
      }
      scanned++
      const p = path.join(dir, k.name)
      if (k.isDirectory()) {
        folders++
        const child: ChildBucket = top
          ? top
          : {
              path: p,
              name: k.name,
              dir: true,
              bytes: 0,
              files: 0
            }
        if (!top) children.set(p, child)
        if (mode === 'all' && !k.isSymbolicLink()) queue.push({ dir: p, top: child })
        continue
      }
      // a symlink is counted where it sits; following it can loop or double count
      const st = await fs.stat(p).catch(() => null)
      if (!st || !st.isFile()) continue
      addFile(top, p, st.size, path.extname(k.name).slice(1).toLowerCase())
    }
  }

  const byExt = [...ext.values()]
    .sort((a, b) => b.bytes - a.bytes || b.count - a.count)
    .slice(0, 80)

  return {
    root,
    mode,
    bytes,
    files,
    folders,
    scanned,
    capped,
    byExt,
    largest,
    children: [...children.values()].sort((a, b) => b.bytes - a.bytes || b.files - a.files)
  }
}
