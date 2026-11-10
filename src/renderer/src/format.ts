import type { Entry } from './api.ts'

export type SortKey = 'name' | 'size' | 'mtime' | 'ext'

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'

/** Persian digits for anything the user reads; paths and file names stay untouched. */
export const fa = (s: string | number): string => String(s).replace(/[0-9]/g, (d) => FA_DIGITS[+d])

const UNITS = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت', 'پتابایت']

/** Human size; folders report nothing unless their size was computed. */
export function fmtSize(bytes: number, dir: boolean): string {
  if (dir) return ''
  if (!bytes) return `۰ ${UNITS[0]}`
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / 1024 ** i
  const n = i === 0 ? String(v) : v.toFixed(v < 10 ? 1 : 0).replace('.', '٫')
  return `${fa(n)} ${UNITS[i]}`
}

/** ۲۰۲۶-۱۱-۱۱ ۰۱:۰۵ — zero-padded, no locale surprises. */
export function fmtDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return fa(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`)
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

/** What the pane shows: live name filter, then sort. */
export function orderEntries(entries: Entry[], key: SortKey, asc: boolean, filter = ''): Entry[] {
  const q = filter.trim().toLowerCase()
  const kept = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries
  return sortEntries(kept, key, asc)
}

export function baseName(p: string): string {
  const s = p.replace(/[\\/]+$/, '')
  return s.split(/[\\/]/).pop() || s
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
  dir: 'پوشه', image: 'تصویر', video: 'ویدئو', audio: 'صدا', archive: 'بایگانی',
  text: 'متن', doc: 'سند', pdf: 'PDF', sheet: 'صفحه گسترده', slides: 'ارائه',
  code: 'کد', file: 'فایل'
}

/** Persian type name; unknown extensions show themselves instead of a useless «فایل». */
export function typeLabel(e: Entry): string {
  const k = kindOf(e)
  return k === 'file' && e.ext ? e.ext.toUpperCase() : LABEL[k]
}

export const isImage = (ext: string): boolean => KIND[ext] === 'image'

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
    const out = o.template
      .replace(/\{name\}/g, base)
      .replace(/\{ext\}/g, ext)
      .replace(/\{nn\}/g, String(num).padStart(Math.max(1, o.pad), '0'))
      .replace(/\{n\}/g, String(num))
    return ext && !out.toLowerCase().endsWith('.' + ext.toLowerCase()) ? `${out}.${ext}` : out
  })
}


