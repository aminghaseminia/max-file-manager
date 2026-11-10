import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Result } from './types.ts'

/** `name (2).ext` instead of overwriting an existing entry. */
export async function freeName(dest: string): Promise<string> {
  const exists = (p: string) => fs.access(p).then(() => true, () => false)
  if (!(await exists(dest))) return dest
  const dir = path.dirname(dest)
  const ext = path.extname(dest)
  const base = path.basename(dest, ext)
  for (let i = 2; ; i++) {
    const cand = path.join(dir, `${base} (${i})${ext}`)
    if (!(await exists(cand))) return cand
  }
}

/**
 * Removes paths — through the OS trash when `trash` is given, permanently otherwise.
 * Never throws: failures are collected per item so a batch can report "3 done · 1 failed".
 * Transfers (copy/move) live in jobs.ts; they need progress and a queue.
 */
export async function remove(
  paths: string[],
  opts: { trash?: (p: string) => Promise<void> } = {}
): Promise<Result> {
  const errors: string[] = []
  let done = 0
  for (const p of paths) {
    try {
      if (!path.isAbsolute(p)) throw new Error('not an absolute path')
      if (opts.trash) await opts.trash(p)
      else await fs.rm(p, { recursive: true, force: true })
      done++
    } catch (e: any) {
      errors.push(`${path.basename(p)}: ${e?.message ?? String(e)}`)
    }
  }
  return { done, errors }
}
