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

const picked = new Map<string, PackIcon>()
for (const [file, url] of Object.entries(files)) {
  const parts = file.split('/')
  const name = parts[parts.length - 1].replace(/\.svg$/i, '')
  const category = parts[parts.length - 2] ?? 'other'
  if (!picked.has(name)) picked.set(name, { name, category, url })
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
