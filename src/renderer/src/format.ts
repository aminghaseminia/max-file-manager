import { t } from './i18n.ts'
import type { Entry } from './api.ts'

export type SortKey = 'name' | 'size' | 'mtime' | 'ext'

const FA_DIGITS = t('۰۱۲۳۴۵۶۷۸۹')

/** Persian digits for anything the user reads; paths and file names stay untouched. */
export const fa = (s: string | number): string => String(s).replace(/[0-9]/g, (d) => FA_DIGITS[+d])

const UNITS = [t('بایت'), t('کیلوبایت'), t('مگابایت'), t('گیگابایت'), t('ترابایت'), t('پتابایت')]

/** Persian civil (Jalali) date from a unix ms timestamp — the conversion users actually read. */
export function toJalali(ms: number): [number, number, number] {
  const d = new Date(ms)
  let gy = d.getFullYear()
  const gm = d.getMonth() + 1
  const gd = d.getDate()
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  let jy = gy <= 1600 ? 0 : 979
  gy -= gy <= 1600 ? 621 : 1600
  const gy2 = gm > 2 ? gy + 1 : gy
  let days =
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) -
    80 +
    gd +
    gdm[gm - 1]
  jy += 33 * Math.floor(days / 12053)
  days %= 12053
  jy += 4 * Math.floor(days / 1461)
  days %= 1461
  if (days > 365) {
    jy += Math.floor((days - 1) / 365)
    days = (days - 1) % 365
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30)
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30)
  return [jy, jm, jd]
}

export type SizeFormat = 'human' | 'bytes'
export type DateFormat = 'iso' | 'jalali' | 'short'

/** Human size; folders report nothing unless their size was computed. */
export function fmtSize(bytes: number, dir: boolean, format: SizeFormat = 'human'): string {
  if (dir) return ''
  if (format === 'bytes') return `${fa(bytes)} بایت`
  if (!bytes) return `۰ ${UNITS[0]}`
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / 1024 ** i
  const n = i === 0 ? String(v) : v.toFixed(v < 10 ? 1 : 0).replace('.', t('٫'))
  return `${fa(n)} ${UNITS[i]}`
}

/** ۲۰۲۶-۱۱-۱۱ ۰۱:۰۵ (میلادی) · ۱۴۰۵-۰۸-۲۰ (شمسی) · ۰۱:۰۵ امروز (کوتاه) */
export function fmtDate(ms: number, format: DateFormat = 'iso', seconds = false): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  const time = `${p(d.getHours())}:${p(d.getMinutes())}${seconds ? ':' + p(d.getSeconds()) : ''}`
  if (format === 'jalali') {
    const [jy, jm, jd] = toJalali(ms)
    return fa(`${jy}-${p(jm)}-${p(jd)} ${time}`)
  }
  if (format === 'short') return fa(time)
  return fa(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`)
}

/** Unix mode bits → rwxr-xr-x */
export function modeString(mode: number): string {
  const bits = ['r', 'w', 'x']
  let out = ''
  for (let i = 8; i >= 0; i--) out += mode & (1 << i) ? bits[(8 - i) % 3] : '-'
  return out
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
export function sortEntries(entries: Entry[], key: SortKey, asc: boolean, foldersFirst = true): Entry[] {
  const dir = asc ? 1 : -1
  return [...entries].sort((a, b) => {
    if (foldersFirst && a.dir !== b.dir) return a.dir ? -1 : 1
    if (key === 'size' && a.size !== b.size) return (a.size - b.size) * dir
    if (key === 'mtime' && a.mtime !== b.mtime) return (a.mtime - b.mtime) * dir
    if (key === 'ext' && a.ext !== b.ext) return COLLATOR.compare(a.ext, b.ext) * dir
    return COLLATOR.compare(a.name, b.name) * (key === 'name' ? dir : 1)
  })
}

/** What the pane shows: live name filter, then sort. */
export function orderEntries(
  entries: Entry[],
  key: SortKey,
  asc: boolean,
  filter = '',
  foldersFirst = true,
  pins?: Set<string>,
  labels?: Record<string, string>,
  ratings?: Record<string, number>
): Entry[] {
  const q = filter.trim().toLowerCase()
  // `#red` keeps only that label; `*3` keeps files rated 3 or more
  let kept = q
    ? entries.filter((e) => {
        if (q.startsWith('#')) return (labels?.[e.name] ?? '').includes(q.slice(1))
        if (q.startsWith('*')) {
          const min = Number(q.slice(1)) || 0
          return (ratings?.[e.name] ?? 0) >= min
        }
        return e.name.toLowerCase().includes(q)
      })
    : entries
  const sorted = sortEntries(kept, key, asc, foldersFirst)
  if (!pins || !pins.size) return sorted
  // pinned names float to the very top, keeping the sort order among themselves
  const pinned = sorted.filter((e) => pins.has(e.name))
  if (!pinned.length) return sorted
  return [...pinned, ...sorted.filter((e) => !pins.has(e.name))]
}

export function baseName(p: string): string {
  const s = p.replace(/[\\/]+$/, '')
  return s.split(/[\\/]/).pop() || s
}

/** Small cached thumbnail for grid tiles; falls back to mfm:// for non-images. */
export function thumbUrl(p: string, side = 256): string {
  const segs = p.split(/[\\/]/).map((s) => (/^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s)))
  return `thumb://local${segs.join('/')}?s=${side}`
}

/** Local file → the mfm:// URL the renderer may load in <img>. */
export function mediaUrl(p: string): string {
  const segs = p.split(/[\\/]/).map((s) => (/^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s)))
  const tail = segs.join('/')
  return `mfm://local${tail.startsWith('/') ? '' : '/'}${tail}`
}

export type Kind = 'dir' | 'image' | 'video' | 'audio' | 'archive' | 'text' | 'doc' | 'pdf' | 'sheet' | 'slides' | 'code' | 'file'

const KIND: Record<string, Kind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  bmp: 'image', avif: 'image', ico: 'image',
  mp4: 'video', mkv: 'video', mov: 'video', webm: 'video', avi: 'video',
  mp3: 'audio', flac: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', opus: 'audio',
  zip: 'archive', tar: 'archive', gz: 'archive', xz: 'archive', '7z': 'archive',
  rar: 'archive', bz2: 'archive', zst: 'archive',
  txt: 'text', md: 'text', log: 'text', rtf: 'text',
  doc: 'doc', docx: 'doc', odt: 'doc', pdf: 'pdf',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', ods: 'sheet',
  ppt: 'slides', pptx: 'slides', odp: 'slides',
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', py: 'code', rs: 'code', c: 'code', h: 'code',
  cpp: 'code', hpp: 'code', java: 'code', go: 'code', rb: 'code', sh: 'code', css: 'code',
  html: 'code', json: 'code', yml: 'code', yaml: 'code', toml: 'code', sql: 'code'
}

export const kindOf = (e: Entry): Kind => (e.dir ? 'dir' : (KIND[e.ext] ?? 'file'))

const LABEL: Record<Kind, string> = {
  dir: t('پوشه'), image: t('تصویر'), video: t('ویدئو'), audio: t('صدا'), archive: t('بایگانی'),
  text: t('متن'), doc: t('سند'), pdf: 'PDF', sheet: t('صفحه گسترده'), slides: t('ارائه'),
  code: t('کد'), file: t('فایل')
}

/** Persian type name; unknown extensions show themselves instead of a useless «فایل». */
export function typeLabel(e: Entry): string {
  const k = kindOf(e)
  return k === 'file' && e.ext ? e.ext.toUpperCase() : LABEL[k]
}

export const isImage = (ext: string): boolean => KIND[ext] === 'image'

/** Formats the archive reader understands (zip + tar family). */
export const isArchiveName = (name: string): boolean =>
  /\.(zip|tar|tgz|tar\.gz|tar\.bz2|tbz2)$/i.test(name)

/** POSIX or Windows: parent folder of a path, keeping its own separator. */
export function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  if (i < 0) return ''
  if (i === 0) return p.slice(0, 1)
  return p.slice(0, i)
}

export function joinPath(dir: string, name: string): string {
  if (!dir) return name
  return /[\\/]$/.test(dir) ? dir + name : dir + (dir.includes('\\') ? '\\' : '/') + name
}


/** Group number for duplicate results; anything else shows its type. */
export const groupLabel = (e: Entry): string => (e.group ? `گروه ${fa(e.group)}` : typeLabel(e))

export type RenameMode = 'template' | 'regex'
export type RenameOpts = {
  mode: RenameMode
  /** template tokens: {name} {ext} {n} {nn} */
  template: string
  find: string
  replace: string
  start: number
  pad: number
  /** per-file tags (ID3/EXIF) for `{title} {artist} {album} {year} {date} {camera}` */
  tags?: Record<string, Record<string, string>>
}

/**
 * Batch-rename planner: takes base names, returns the new base names in the same order.
 * Pure so the dialog can preview exactly what will happen before touching a file.
 */
export function planRename(names: string[], o: RenameOpts): string[] {
  if (o.mode === 'regex') {
    let re: RegExp
    try {
      re = new RegExp(o.find, 'g')
    } catch {
      return [...names] // an invalid pattern must not rename anything
    }
    return names.map((n) => n.replace(re, o.replace))
  }
  return names.map((n, i) => {
    const dot = n.lastIndexOf('.')
    const base = dot > 0 ? n.slice(0, dot) : n
    const ext = dot > 0 ? n.slice(dot + 1) : ''
    const num = o.start + i
    const tag = o.tags?.[n] ?? {}
    const out = o.template
      .replace(/\{name\}/g, base)
      .replace(/\{ext\}/g, ext)
      .replace(/\{title\}/g, tag.title ?? base)
      .replace(/\{artist\}/g, tag.artist ?? '')
      .replace(/\{album\}/g, tag.album ?? '')
      .replace(/\{year\}/g, tag.year ?? '')
      .replace(/\{date\}/g, (tag.date ?? '').slice(0, 10))
      .replace(/\{camera\}/g, tag.camera ?? '')
      .replace(/\{nn\}/g, String(num).padStart(Math.max(1, o.pad), '0'))
      .replace(/\{n\}/g, String(num))
    return ext && !out.toLowerCase().endsWith('.' + ext.toLowerCase()) ? `${out}.${ext}` : out
  })
}



/** The folders every desktop expects to be searchable by default. */
export function defaultSearchRoots(home: string): string[] {
  if (!home) return []
  return ['Documents', 'Downloads', 'Desktop', 'Pictures', 'Music', 'Videos'].map((d) => joinPath(home, d))
}
