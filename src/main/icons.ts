import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export type IconTheme = { name: string; dir: string }
export type IconRef = { name: string; path: string }

const CAP = 4000
const cache = new Map<string, IconRef[]>()

const isIcon = (n: string) => /\.(svg|png)$/i.test(n)

/** Prefer scalable, then a mid size — a 16px icon blown up looks broken. */
const rank = (p: string): number => {
  if (p.includes('/scalable/')) return 0
  if (p.includes('/64/')) return 1
  if (p.includes('/48/')) return 2
  if (p.includes('/32/')) return 3
  return 4
}

/** Directories that hold icon themes: the system ones plus whatever the user added. */
export async function themeDirs(extra: string[] = []): Promise<IconTheme[]> {
  const out: IconTheme[] = []
  const seen = new Set<string>()
  const add = (name: string, dir: string) => {
    if (seen.has(name) || seen.has(dir)) return
    seen.add(name)
    seen.add(dir)
    out.push({ name, dir })
  }

  for (const base of [
    '/usr/share/icons',
    '/usr/local/share/icons',
    path.join(os.homedir(), '.local/share/icons'),
    path.join(os.homedir(), '.icons')
  ]) {
    if (await fs.access(path.join(base, 'index.theme')).then(() => true, () => false)) {
      add(path.basename(base), base)
      continue
    }
    const kids = await fs.readdir(base, { withFileTypes: true }).catch(() => [])
    for (const k of kids) if (k.isDirectory()) add(k.name, path.join(base, k.name))
  }

  // a user pack is the folder itself, not one level down
  for (const dir of extra) if (dir) add(path.basename(dir), dir)
  return out
}

/** Every icon name in a theme/pack folder, deduped by name with the best path kept. */
export async function iconsIn(themeDir: string): Promise<IconRef[]> {
  const hit = cache.get(themeDir)
  if (hit) return hit
  const best = new Map<string, string>()
  const stack = [themeDir]
  let seen = 0
  while (stack.length && seen < CAP) {
    const dir = stack.pop()!
    const kids = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const k of kids) {
      const p = path.join(dir, k.name)
      if (k.isDirectory()) {
        stack.push(p)
        continue
      }
      if (!isIcon(k.name) || ++seen > CAP) continue
      const name = k.name.replace(/\.(svg|png)$/i, '')
      const cur = best.get(name)
      if (!cur || rank(p) < rank(cur)) best.set(name, p)
    }
  }
  const list = [...best.entries()]
    .map(([name, p]) => ({ name, path: p }))
    .sort((a, b) => a.name.localeCompare(b.name))
  cache.set(themeDir, list)
  return list
}
