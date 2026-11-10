import type { Entry } from './api.ts'

export type SortKey = 'name' | 'size' | 'mtime' | 'ext'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/** Human size; folders report no size of their own. */
export function fmtSize(bytes: number, dir: boolean): string {
  if (dir) return ''
  if (!bytes) return '0 B'
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / 1024 ** i
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${UNITS[i]}`
}

/** Local time, zero-padded, no locale surprises: 2026-11-11 14:03 */
export function fmtDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export type Crumb = { name: string; path: string }

/** Breadcrumb segments for POSIX and Windows paths. */
export function crumbs(p: string): Crumb[] {
  const win = /^[A-Za-z]:[\\/]/.test(p)
  const parts = p.split(/[\\/]+/).filter(Boolean)
  if (win) {
    const out: Crumb[] = [{ name: parts[0], path: parts[0] + '\\' }]
    let acc = parts[0] + '\\'
    for (const s of parts.slice(1)) {
      acc = acc.endsWith('\\') ? acc + s : acc + '\\' + s
      out.push({ name: s, path: acc })
    }
    return out
  }
  const out: Crumb[] = [{ name: '/', path: '/' }]
  let acc = ''
  for (const s of parts) {
    acc += '/' + s
    out.push({ name: s, path: acc })
  }
  return out
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Folders always first (Directory Opus default), then the chosen column. */
export function sortEntries(entries: Entry[], key: SortKey, asc: boolean): Entry[] {
  const dir = asc ? 1 : -1
  return [...entries].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1
    if (key === 'size' && a.size !== b.size) return (a.size - b.size) * dir
    if (key === 'mtime' && a.mtime !== b.mtime) return (a.mtime - b.mtime) * dir
    if (key === 'ext' && a.ext !== b.ext) return COLLATOR.compare(a.ext, b.ext) * dir
    return COLLATOR.compare(a.name, b.name) * (key === 'name' ? dir : 1)
  })
}

export function baseName(p: string): string {
  const s = p.replace(/[\\/]+$/, '')
  return s.split(/[\\/]/).pop() || s
}
