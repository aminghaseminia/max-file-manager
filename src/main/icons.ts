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

/** The pack the app itself prefers for file and folder icons. */
export const PREFERRED_THEME = 'Pure'

/** Pure first, then the theme the desktop is using, then the usual fallbacks. */
export function themeRank(name: string, active = ''): number {
  if (name === PREFERRED_THEME) return 0
  if (active && name === active) return 1
  if (name === 'breeze' || name === 'breeze-dark') return 2
  if (name === 'hicolor') return 4
  return 3
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
  // the picker must open on the pack we actually use, not on whatever readdir returned first
  return out.sort((a, b) => themeRank(a.name) - themeRank(b.name))
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

/** Names that mean "the ordinary folder" — resolving them would only hide our own glyph. */
const GENERIC = new Set(['folder', 'inode-directory', 'folder-symbolic', 'folder-open', 'folder-new'])

const nameCache = new Map<string, string | null>()

const exists = (p: string) => fs.access(p).then(() => true, () => false)

let preferredTheme: string | null | undefined

/** The icon theme KDE is actually using, read from kdeglobals once. */
async function activeTheme(): Promise<string> {
  if (preferredTheme !== undefined) return preferredTheme ?? 'breeze'
  const txt = await fs.readFile(path.join(os.homedir(), '.config/kdeglobals'), 'utf8').catch(() => '')
  let section = ''
  let theme = ''
  for (const line of txt.split(/\r?\n/)) {
    const sec = /^\s*\[(.+)\]\s*$/.exec(line)
    if (sec) {
      section = sec[1]
      continue
    }
    const kv = /^\s*Theme\s*=\s*(.+?)\s*$/.exec(line)
    if (kv && section === 'Icons') theme = kv[1]
  }
  preferredTheme = theme || null
  return theme || 'breeze'
}

const SIZES = ['scalable', '256', '128', '96', '64', '48', '32', '24', '22', '16']
const CONTEXTS = ['places', 'apps', 'mimetypes', 'devices', 'categories', 'actions', '']

/**
 * A KDE/GTK icon *name* (`folder-red`, `folder-documents`) → the file to show. Walks the same
 * folders the desktop itself does, so `.directory` icons that Dolphin set keep working.
 */
export async function resolveIconName(name: string, opts: { generic?: boolean } = {}): Promise<string | null> {
  if (!name) return null
  if (!opts.generic && GENERIC.has(name)) return null
  if (path.isAbsolute(name)) return (await exists(name)) ? name : null
  if (nameCache.has(name)) return nameCache.get(name) ?? null

  const active = await activeTheme()
  const themes = (await themeDirs()).sort((a, b) => themeRank(a.name, active) - themeRank(b.name, active))

  for (const theme of themes.slice(0, 8)) {
    for (const size of SIZES) {
      for (const ctx of CONTEXTS) {
        for (const ext of ['svg', 'png']) {
          // hicolor puts the size first, breeze puts the context first — try both
          for (const dirs of [
            [size, ctx],
            [ctx, size],
            [`${size}x${size}`, ctx]
          ]) {
            const p = path.join(theme.dir, ...dirs.filter(Boolean), `${name}.${ext}`)
            if (await exists(p)) {
              nameCache.set(name, p)
              return p
            }
          }
        }
      }
    }
  }
  nameCache.set(name, null)
  return null
}

/** Standard names a desktop theme uses for each file kind, best match first. */
const KIND_NAMES: Record<string, string[]> = {
  dir: ['folder'],
  image: ['image-x-generic'],
  video: ['video-x-generic'],
  audio: ['audio-x-generic'],
  archive: ['package-x-generic', 'application-x-archive'],
  code: ['text-x-script', 'text-x-generic'],
  text: ['text-x-generic'],
  doc: ['x-office-document', 'text-x-generic'],
  pdf: ['application-pdf'],
  sheet: ['x-office-spreadsheet', 'text-x-generic'],
  slides: ['x-office-presentation', 'text-x-generic'],
  file: ['unknown', 'text-x-generic']
}

let kindCache: Promise<Record<string, string>> | null = null

/** The theme's file icons, one per kind; the renderer falls back to the line glyphs it lacks. */
export function iconSetPaths(): Promise<Record<string, string>> {
  kindCache ??= (async () => {
    const out: Record<string, string> = {}
    for (const [kind, names] of Object.entries(KIND_NAMES)) {
      for (const name of names) {
        const file = await resolveIconName(name, { generic: true })
        if (file) {
          out[kind] = file
          break
        }
      }
    }
    return out
  })()
  return kindCache
}
