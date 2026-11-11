export type UpdateInfo = {
  current: string
  latest: string | null
  url: string | null
  notes: string | null
  newer: boolean
  checkedAt: number
  error?: string
}

export const RELEASES_REPO = 'majidasgari/max-file-manager'

/** "1.2.10" is newer than "1.2.9"; a leading v and a -tag suffix are tolerated. */
export function isNewer(candidate: string, current: string): boolean {
  const norm = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0)
  const a = norm(candidate)
  const b = norm(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/** Picks the highest tag from a releases payload; drafts and prereleases are ignored. */
export function pickLatest(releases: { tag_name?: string; html_url?: string; body?: string; draft?: boolean; prerelease?: boolean }[]): {
  tag: string
  url: string
  notes: string
} | null {
  let best: { tag: string; url: string; notes: string } | null = null
  for (const r of releases) {
    if (!r?.tag_name || r.draft || r.prerelease) continue
    if (!best || isNewer(r.tag_name, best.tag)) {
      best = { tag: r.tag_name, url: r.html_url ?? '', notes: (r.body ?? '').slice(0, 600) }
    }
  }
  return best
}
