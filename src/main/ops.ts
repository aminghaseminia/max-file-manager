import { promises as fs } from 'node:fs'
import path from 'node:path'

export type OpKind = 'copy' | 'move' | 'trash' | 'delete' | 'mkdir' | 'rename'

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
 * Runs one file operation per path and never throws: a failure is collected per item so the
 * window can report "3 done · 1 failed" instead of losing the whole batch.
 * `trash` is injected because only the main process may own the OS trash.
 */
// shortcut: no progress/cancel for long transfers; upgrade when transfers get a queue.
export async function runOp(
  kind: OpKind,
  paths: string[],
  opts: { dest?: string; name?: string; trash?: (p: string) => Promise<void> } = {}
): Promise<{ done: number; errors: string[] }> {
  const errors: string[] = []
  let done = 0
  for (const src of paths) {
    try {
      if (!path.isAbsolute(src)) throw new Error('not an absolute path')
      if (kind === 'copy' || kind === 'move') {
        if (!opts.dest || !path.isAbsolute(opts.dest)) throw new Error('no destination')
        const target = await freeName(path.join(opts.dest, path.basename(src)))
        if (kind === 'copy') {
          await fs.cp(src, target, { recursive: true, errorOnExist: true, force: false })
        } else {
          try {
            await fs.rename(src, target)
          } catch (e: any) {
            if (e?.code !== 'EXDEV') throw e // only a cross-device move needs copy+delete
            await fs.cp(src, target, { recursive: true })
            await fs.rm(src, { recursive: true, force: true })
          }
        }
      } else if (kind === 'trash') {
        if (!opts.trash) throw new Error('trash unavailable')
        await opts.trash(src)
      } else if (kind === 'delete') {
        await fs.rm(src, { recursive: true, force: true })
      } else if (kind === 'mkdir') {
        if (!opts.name) throw new Error('no folder name')
        await fs.mkdir(path.join(src, opts.name))
      } else if (kind === 'rename') {
        if (!opts.name) throw new Error('no new name')
        await fs.rename(src, path.join(path.dirname(src), opts.name))
      }
      done++
    } catch (e: any) {
      errors.push(`${path.basename(src)}: ${e?.message ?? String(e)}`)
    }
  }
  return { done, errors }
}
