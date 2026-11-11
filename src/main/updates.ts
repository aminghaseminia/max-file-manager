import { app, net, shell } from 'electron'
import { isNewer, pickLatest, RELEASES_REPO, type UpdateInfo } from './updates-core.ts'

export type { UpdateInfo } from './updates-core.ts'
export { isNewer, pickLatest } from './updates-core.ts'

const TTL = 3_600_000
let cache: UpdateInfo | null = null

/** Asks GitHub for the newest release; cached for an hour because it is a network call. */
export async function checkUpdate(force = false): Promise<UpdateInfo> {
  const current = app.getVersion()
  if (!force && cache && Date.now() - cache.checkedAt < TTL) return cache
  const info: UpdateInfo = {
    current,
    latest: null,
    url: null,
    notes: null,
    newer: false,
    checkedAt: Date.now()
  }
  try {
    const res = await net.fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'max-file-manager' }
    })
    if (!res.ok) throw new Error(`GitHub ${res.status}`)
    const list = (await res.json()) as Parameters<typeof pickLatest>[0]
    const best = pickLatest(Array.isArray(list) ? list : [])
    if (best) {
      info.latest = best.tag
      info.url = best.url || `https://github.com/${RELEASES_REPO}/releases`
      info.notes = best.notes
      info.newer = isNewer(best.tag, current)
    }
  } catch (e: any) {
    info.error = String(e?.message ?? e)
  }
  cache = info
  return info
}

export function openRelease(url: string): { ok: true } | { error: string } {
  if (!/^https:\/\/github\.com\/majidasgari\/max-file-manager\//.test(url)) {
    return { error: 'نشانی نامعتبر' }
  }
  void shell.openExternal(url)
  return { ok: true }
}
