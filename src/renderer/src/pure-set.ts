/**
 * The complete Pure icon theme (64px SVG set), bundled with the app. Vite emits one asset per
 * file and this module indexes them by icon name, so the picker works on macOS/Windows where the
 * theme is not installed and no icon is ever read from the OS at runtime.
 */
const files = import.meta.glob('./assets/pure/set/**/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

export type PackIcon = { name: string; category: string; url: string }

/**
 * A git checkout without symlink support (the default on Windows) writes each theme symlink as a
 * small text file holding only its target's name, so Vite faithfully inlines that name as
 * `data:image/svg+xml,wine.svg` — a URI that is not an image and never loads (the title-bar logo
 * and 2000+ app icons went blank that way). Resolve those names against the pack, following
 * chains, so both platforms end up with real pixels instead of a broken icon.
 */
const LINK_ONLY = /^data:image\/svg\+xml,([^\s,%][^,]*\.svg)$/i

const linkTarget = (url: string): string | null => {
  const m = LINK_ONLY.exec(url)
  return m ? m[1] : null
}

/** `./assets/pure/set/apps/../places/x.svg` → `./assets/pure/set/places/x.svg` (glob keys are POSIX). */
const normalizeKey = (key: string): string => {
  const out: string[] = []
  for (const part of key.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  const joined = out.join('/')
  return key.startsWith('./') ? `./${joined}` : joined
}

const dirOf = (key: string): string => {
  const at = key.lastIndexOf('/')
  return at < 0 ? '' : key.slice(0, at)
}

/** Follow `symlink → target` until a real SVG turns up; a cyclic or missing target keeps the URL. */
function resolveLink(file: string, url: string, depth = 0): string {
  const target = linkTarget(url)
  if (!target || depth > 8) return url
  const next = normalizeKey(`${dirOf(file)}/${target}`)
  const nextUrl = files[next]
  return nextUrl === undefined ? url : resolveLink(next, nextUrl, depth + 1)
}

const picked = new Map<string, PackIcon>()
for (const [file, url] of Object.entries(files)) {
  const parts = file.split('/')
  const name = parts[parts.length - 1].replace(/\.svg$/i, '')
  const category = parts[parts.length - 2] ?? 'other'
  if (!picked.has(name)) picked.set(name, { name, category, url: resolveLink(file, url) })
}

export const PURE_PACK: PackIcon[] = [...picked.values()].sort((a, b) =>
  a.name.localeCompare(b.name)
)

export const PURE_URL_BY_NAME: Record<string, string> = Object.fromEntries(
  PURE_PACK.map((i) => [i.name, i.url])
)

export const PURE_CATEGORIES: string[] = [...new Set(PURE_PACK.map((i) => i.category))].sort()

/** `p:<name>` is the stored form: stable across rebuilds, unlike a hashed asset URL. */
export const pureIconUrl = (icon: string): string | undefined =>
  icon.startsWith('p:') ? PURE_URL_BY_NAME[icon.slice(2)] : undefined
