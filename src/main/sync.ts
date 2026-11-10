import { promises as fs, createReadStream } from 'node:fs'
import path from 'node:path'

export type SyncState =
  | 'same'
  | 'leftOnly'
  | 'rightOnly'
  | 'leftNewer'
  | 'rightNewer'
  | 'sizeDiff'
  | 'contentDiff'
  | 'typeDiff'

export type SyncSide = { size: number; mtime: number; dir: boolean }
export type SyncRow = { rel: string; state: SyncState; left?: SyncSide; right?: SyncSide }

const SAME_MTIME_MS = 2000
const MAX_ROWS = 20000

type Tree = Map<string, SyncSide>

async function walk(root: string, rel = '', out: Tree = new Map()): Promise<Tree> {
  const full = rel ? path.join(root, rel) : root
  const st = await fs.lstat(full).catch(() => null)
  if (!st) return out
  if (rel) out.set(rel, { size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs, dir: st.isDirectory() })
  if (!st.isDirectory()) return out
  for (const name of await fs.readdir(full)) {
    if (name === '.mfm.json') continue
    await walk(root, rel ? path.join(rel, name) : name, out)
  }
  return out
}

/**
 * Newest wins, which is what makes a one-way sync safe: a file that differs in size but is older
 * must not overwrite the newer one. Only a size difference with the same timestamp is ambiguous.
 */
const stateOf = (l: SyncSide, r: SyncSide): SyncState => {
  if (l.dir !== r.dir) return 'typeDiff'
  if (l.dir) return 'same'
  const d = l.mtime - r.mtime
  if (Math.abs(d) > SAME_MTIME_MS) return d > 0 ? 'leftNewer' : 'rightNewer'
  return l.size === r.size ? 'same' : 'sizeDiff'
}

/**
 * Recursive comparison of two folders. Cheap by design: size + mtime decide, and `deep` adds a
 * content hash for files that look identical.
 */
export async function compareTrees(
  left: string,
  right: string,
  deep = false
): Promise<{ rows: SyncRow[]; leftCount: number; rightCount: number; capped: boolean }> {
  if (!path.isAbsolute(left) || !path.isAbsolute(right)) {
    return { rows: [], leftCount: 0, rightCount: 0, capped: false }
  }
  const L = await walk(left)
  const R = await walk(right)
  const rels = [...new Set([...L.keys(), ...R.keys()])].sort()
  const rows: SyncRow[] = []
  for (const rel of rels) {
    if (rows.length >= MAX_ROWS) break
    const l = L.get(rel)
    const r = R.get(rel)
    if (l && !r) rows.push({ rel, state: 'leftOnly', left: l })
    else if (!l && r) rows.push({ rel, state: 'rightOnly', right: r })
    else if (l && r) {
      let st = stateOf(l, r)
      if (st === 'same' && deep && !l.dir) {
        const [ha, hb] = await Promise.all([hashOf(path.join(left, rel)), hashOf(path.join(right, rel))])
        if (ha !== hb) st = 'contentDiff'
      }
      rows.push({ rel, state: st, left: l, right: r })
    }
  }
  return { rows, leftCount: L.size, rightCount: R.size, capped: rels.length > MAX_ROWS }
}

async function hashOf(p: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  const h = createHash('sha256')
  for await (const chunk of createReadStream(p)) h.update(chunk as Buffer)
  return h.digest('hex')
}

export type SyncMode = 'ltr' | 'rtl'
export type SyncResult = { copied: number; deleted: number; skipped: number; errors: string[] }

/** Which rows a run in this direction touches. */
export function planRows(rows: SyncRow[], mode: SyncMode, deleteExtra: boolean): { copy: SyncRow[]; remove: SyncRow[] } {
  const copy: SyncRow[] = []
  const remove: SyncRow[] = []
  for (const row of rows) {
    if (mode === 'ltr') {
      if (row.state === 'leftOnly' || row.state === 'leftNewer' || row.state === 'sizeDiff' || row.state === 'contentDiff' || row.state === 'typeDiff') copy.push(row)
      else if (row.state === 'rightOnly' && deleteExtra) remove.push(row)
    } else {
      if (row.state === 'rightOnly' || row.state === 'rightNewer' || row.state === 'sizeDiff' || row.state === 'contentDiff' || row.state === 'typeDiff') copy.push(row)
      else if (row.state === 'leftOnly' && deleteExtra) remove.push(row)
    }
  }
  return { copy, remove }
}

/**
 * Runs the plan. `trash` is injected so extra files never get hard-deleted by this module.
 */
export async function applySync(
  left: string,
  right: string,
  rows: SyncRow[],
  mode: SyncMode,
  deleteExtra: boolean,
  trash: (p: string) => Promise<void>
): Promise<SyncResult> {
  const res: SyncResult = { copied: 0, deleted: 0, skipped: 0, errors: [] }
  if (!path.isAbsolute(left) || !path.isAbsolute(right)) {
    res.errors.push('مسیر نامعتبر')
    return res
  }
  const src = mode === 'ltr' ? left : right
  const dst = mode === 'ltr' ? right : left
  const { copy, remove } = planRows(rows, mode, deleteExtra)

  for (const row of copy) {
    if (row.state === 'typeDiff') {
      res.errors.push(`${row.rel}: نوع فایل و پوشه یکی نیست`)
      continue
    }
    const from = path.join(src, row.rel)
    const to = path.join(dst, row.rel)
    try {
      await fs.mkdir(path.dirname(to), { recursive: true })
      await fs.copyFile(from, to)
      res.copied++
    } catch (e: any) {
      res.errors.push(`${row.rel}: ${e?.message ?? String(e)}`)
    }
  }
  for (const row of remove) {
    try {
      await trash(path.join(dst, row.rel))
      res.deleted++
    } catch (e: any) {
      res.errors.push(`${row.rel}: ${e?.message ?? String(e)}`)
    }
  }
  res.skipped = rows.length - copy.length - remove.length
  return res
}

export type DiffLine = { kind: 'same' | 'add' | 'del' | 'change'; a?: number; b?: number; text: string }
export type DiffResult = {
  lines: DiffLine[]
  added: number
  removed: number
  binary: boolean
  /** true when the file was too big for a real LCS and lines were compared by position */
  coarse: boolean
}

const isBinary = (buf: Buffer) => buf.subarray(0, 8000).includes(0)

/** Line diff between two text files; falls back to positional comparison for very large inputs. */
export async function diffFiles(a: string, b: string): Promise<DiffResult> {
  const empty: DiffResult = { lines: [], added: 0, removed: 0, binary: false, coarse: false }
  if (!path.isAbsolute(a) || !path.isAbsolute(b)) return empty
  const [ba, bb] = await Promise.all([fs.readFile(a).catch(() => null), fs.readFile(b).catch(() => null)])
  if (!ba || !bb) return empty
  if (isBinary(ba) || isBinary(bb)) {
    let off = 0
    while (off < Math.min(ba.length, bb.length) && ba[off] === bb[off]) off++
    return { ...empty, binary: true, lines: [{ kind: 'change', text: `این دو فایل باینری‌اند؛ اولین تفاوت در بایت ${off}` }] }
  }
  const la = ba.toString('utf8').split(/\r?\n/)
  const lb = bb.toString('utf8').split(/\r?\n/)
  return diffLines(la, lb)
}

export function diffLines(la: string[], lb: string[]): DiffResult {
  const lines: DiffLine[] = []
  let added = 0
  let removed = 0
  const cap = la.length * lb.length
  if (cap > 400_000) {
    // shortcut: positional diff for huge files; upgrade to a real Myers diff if this ever matters
    const n = Math.max(la.length, lb.length)
    for (let i = 0; i < n; i++) {
      const x = la[i]
      const y = lb[i]
      if (x === y) lines.push({ kind: 'same', a: i + 1, b: i + 1, text: x ?? '' })
      else if (x === undefined) {
        lines.push({ kind: 'add', b: i + 1, text: y })
        added++
      } else if (y === undefined) {
        lines.push({ kind: 'del', a: i + 1, text: x })
        removed++
      } else {
        lines.push({ kind: 'change', a: i + 1, b: i + 1, text: y })
        added++
        removed++
      }
    }
    return { lines, added, removed, binary: false, coarse: true }
  }

  // classic LCS table, small inputs only
  const n = la.length
  const m = lb.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = la[i] === lb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (la[i] === lb[j]) {
      lines.push({ kind: 'same', a: i + 1, b: j + 1, text: la[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ kind: 'del', a: i + 1, text: la[i] })
      removed++
      i++
    } else {
      lines.push({ kind: 'add', b: j + 1, text: lb[j] })
      added++
      j++
    }
  }
  while (i < n) {
    lines.push({ kind: 'del', a: i + 1, text: la[i] })
    removed++
    i++
  }
  while (j < m) {
    lines.push({ kind: 'add', b: j + 1, text: lb[j] })
    added++
    j++
  }
  return { lines, added, removed, binary: false, coarse: false }
}
