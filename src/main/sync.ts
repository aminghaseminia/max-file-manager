/**
 * Line diff between two text files. The two-folder synchronisation engine lives next door in
 * `sync-core.ts` / `sync-engine.ts` / `sync-service.ts`; this module was kept because the diff is a
 * different problem (and a different UI). Everything here is pure except reading the two files.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type DiffLine = { kind: 'same' | 'add' | 'del' | 'change'; a?: number; b?: number; text: string }
export type DiffResult = {
  lines: DiffLine[]
  added: number
  removed: number
  binary: boolean
  /** true when the file was too big for a real LCS and lines were compared by position */
  coarse: boolean
}

const isBinary = (buf: Buffer): boolean => buf.subarray(0, 8000).includes(0)

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
