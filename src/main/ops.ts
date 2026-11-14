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

export type LinkResult = { ok: true; path: string } | { ok: false; error: string }

/** Windows needs `junction` for folders (no admin); files need Developer Mode for `file`. */
export const symlinkType = (platform: string, isDir: boolean): 'junction' | 'dir' | 'file' =>
  platform === 'win32' ? (isDir ? 'junction' : 'file') : isDir ? 'dir' : 'file'

/**
 * Create a symbolic link next to the target. Never overwrites: an existing link path is refused.
 * On Windows folders become junctions (works without elevation) and files use a real symlink;
 * a hard link is deliberately not used as a fallback because it is not what the user asked for.
 */
export async function createSymlink(
  target: string,
  linkPath: string,
  platform = process.platform
): Promise<LinkResult> {
  if (!path.isAbsolute(target) || !path.isAbsolute(linkPath)) {
    return { ok: false, error: 'absolute paths required' }
  }
  const src = path.resolve(target)
  const dst = path.resolve(linkPath)
  if (src === dst) return { ok: false, error: 'target and link are the same path' }
  const st = await fs.stat(src).catch(() => null)
  if (!st) return { ok: false, error: 'target does not exist' }
  const parent = await fs.stat(path.dirname(dst)).catch(() => null)
  if (!parent?.isDirectory()) return { ok: false, error: 'link folder does not exist' }
  if (await fs.lstat(dst).then(() => true, () => false)) {
    return { ok: false, error: 'link path already exists' }
  }
  try {
    await fs.symlink(src, dst, symlinkType(platform, st.isDirectory()))
    return { ok: true, path: dst }
  } catch (e: any) {
    if (e?.code === 'EPERM') {
      return {
        ok: false,
        error: 'permission denied (on Windows enable Developer Mode or run as administrator)'
      }
    }
    return { ok: false, error: e?.code ?? e?.message ?? String(e) }
  }
}
