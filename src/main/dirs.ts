import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readMeta } from './meta.ts'
import type { DirRef } from './types.ts'

export type DirsOpts = {
  showHidden?: boolean
  /**
   * Include folders that are symbolic links. They are skipped by default (a listing is about
   * real entries); a folder tree wants them, because a linked folder navigates like any other.
   */
  followLinks?: boolean
}

/** The sub-folders of `dir`, in readdir order, capped so a 100k-folder directory stays usable. */
export async function dirs(dir: string, o: DirsOpts = {}): Promise<DirRef[]> {
  const showHidden = o.showHidden === true
  const followLinks = o.followLinks === true
  const kids = (await fs.readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter(
      (k) =>
        (k.isDirectory() || (followLinks && k.isSymbolicLink())) &&
        (showHidden || !k.name.startsWith('.'))
    )
    .slice(0, 1000)

  const out: DirRef[] = []
  for (let i = 0; i < kids.length; i += 64) {
    const slice = await Promise.all(
      kids.slice(i, i + 64).map(async (k): Promise<DirRef | null> => {
        const p = path.join(dir, k.name)
        const link = k.isSymbolicLink()
        // a symlink is only a folder if its target is one (and may be broken)
        if (link && !(await fs.stat(p).then((s) => s.isDirectory(), () => false))) return null
        if (!showHidden && (await readMeta(p))?.hidden) return null
        return link ? { name: k.name, path: p, link: true } : { name: k.name, path: p }
      })
    )
    for (const item of slice) if (item) out.push(item)
  }
  return out
}
