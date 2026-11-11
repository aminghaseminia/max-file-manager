import { promises as fs } from 'node:fs'
import path from 'node:path'

export type PreviewKind = 'dir' | 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'office' | 'binary'
export type Preview = {
  kind: PreviewKind
  size: number
  mtime: number
  text?: string
  /** the text/image was cut at the size cap */
  capped?: boolean
}

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'])
const AUDIO = new Set(['mp3', 'flac', 'wav', 'ogg', 'm4a', 'opus'])
const VIDEO = new Set(['mp4', 'mkv', 'webm', 'mov', 'avi'])
const OFFICE = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'])

const XML_TEXT = /<[^>]+>/g

const decodeXml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** Trim blank edges, collapse blank runs; spaces collapse, tabs survive (table cells). */
const tidy = (s: string): string =>
  s
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').replace(/ +\t/g, '\t').replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/**
 * WordprocessingML body → readable text.
 *
 * Paragraphs become lines, table cells become tab-separated columns, tabs and hard
 * breaks survive; field codes (`instrText`) and deleted text are dropped so the
 * preview shows the document, not its plumbing.
 */
export function docxText(xml: string): string {
  const start = xml.indexOf('<w:body')
  const end = xml.lastIndexOf('</w:body>')
  const body = start >= 0 && end > start ? xml.slice(start, end + 9) : xml
  let out = ''
  let inCell = false
  let inText = false
  let skip = 0
  const token = /<(\/?)([a-zA-Z]+:[a-zA-Z]+)\b[^>]*?(\/?)>|([^<]+)/g
  for (const m of body.matchAll(token)) {
    const [, closing, tag, self, text] = m
    if (text !== undefined) {
      // pretty-printed XML carries newlines between tags; only <w:t> text is document text
      if (!skip && (inText || text.trim())) out += decodeXml(text)
      continue
    }
    if (tag === 'w:t') inText = !closing && !self
    if (tag === 'w:instrText' || tag === 'w:delText') {
      if (!self) skip += closing ? -1 : 1
      continue
    }
    if (skip) continue
    if (tag === 'w:tc') {
      if (closing) {
        inCell = false
        out += '\t'
      } else if (!self) inCell = true
      continue
    }
    if (self) {
      if (tag === 'w:tab') out += '\t'
      else if (tag === 'w:br' || tag === 'w:cr') out += '\n'
      continue
    }
    if (closing && (tag === 'w:p' || tag === 'w:tr' || tag === 'w:h')) {
      // a paragraph inside a table cell is a space; at the top level it is a line
      out += inCell ? ' ' : '\n'
    }
  }
  return tidy(out)
}

/** `xl/sharedStrings.xml` → one string per `<si>` (rich text runs are joined). */
export function xlsxSharedStrings(xml: string): string[] {
  const out: string[] = []
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    out.push(tidy(decodeXml(m[1].replace(XML_TEXT, '')).replace(/\n+/g, ' ')))
  }
  return out
}

/** One worksheet → tab-separated rows, with shared-string indexes resolved. */
export function xlsxSheetText(xml: string, shared: string[]): string {
  const rows: string[] = []
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []
    for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cell[1]
      const inner = cell[2]
      const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ''
      if (/t="s"/.test(attrs)) cells.push(shared[Number(value)] ?? '')
      else if (/t="inlineStr"/.test(attrs)) {
        cells.push(tidy(decodeXml(inner.replace(XML_TEXT, '')).replace(/\n+/g, ' ')))
      } else cells.push(decodeXml(value).trim())
    }
    if (cells.some((c) => c)) rows.push(cells.join('\t'))
  }
  return rows.join('\n')
}

/** One presentation slide → one line per paragraph. */
export function pptxSlideText(xml: string): string {
  return tidy(
    decodeXml(
      xml
        .replace(/<a:br\b[^>]*\/>/g, '\n')
        .replace(/<\/a:p>/g, '\n')
        .replace(XML_TEXT, '')
    )
  )
}

/** OpenDocument content.xml (odt/ods/odp) → paragraphs and table rows. */
export function odfText(xml: string): string {
  return tidy(
    decodeXml(
      xml
        .replace(/<text:tab\b[^>]*\/>/g, '\t')
        .replace(/<text:(?:line-break|soft-page-break)\b[^>]*\/>/g, '\n')
        .replace(/<\/table:table-cell>/g, '\t')
        .replace(/<\/(?:text:(?:p|h)|table:table-row)>/g, '\n')
        .replace(XML_TEXT, '')
    )
  )
}

/** Office files are zip+XML; the readable text is good enough for a preview and needs no engine. */
async function officePreview(
  p: string,
  base: { size: number; mtime: number },
  ext: string
): Promise<Preview> {
  const cap = 200 * 1024
  const { unzipSync } = await import('fflate')
  const buf = await fs.readFile(p).catch(() => null)
  if (!buf) return { kind: 'binary', ...base }
  const textOf = (data: Uint8Array | undefined, map: (xml: string) => string): string =>
    data ? map(Buffer.from(data).toString('utf8')) : ''
  try {
    let text = ''
    if (ext === 'docx') {
      const zip = unzipSync(new Uint8Array(buf), {
        filter: (f) => f.name === 'word/document.xml'
      })
      text = textOf(zip['word/document.xml'], docxText)
    } else if (ext === 'pptx') {
      const zip = unzipSync(new Uint8Array(buf), {
        filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name)
      })
      text = Object.keys(zip)
        .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]))
        .map((name) => textOf(zip[name], pptxSlideText))
        .filter(Boolean)
        .join('\n\n')
    } else if (ext === 'xlsx') {
      const zip = unzipSync(new Uint8Array(buf), {
        filter: (f) =>
          f.name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet1\.xml$/.test(f.name)
      })
      const sharedXml = zip['xl/sharedStrings.xml']
      const shared = sharedXml ? xlsxSharedStrings(Buffer.from(sharedXml).toString('utf8')) : []
      text = textOf(zip['xl/worksheets/sheet1.xml'], (xml) => xlsxSheetText(xml, shared))
    } else {
      const zip = unzipSync(new Uint8Array(buf), { filter: (f) => f.name === 'content.xml' })
      text = textOf(zip['content.xml'], odfText)
    }
    text = text.slice(0, cap)
    // an empty extraction is worse than no preview: the panel shows its «no preview» state
    return text ? { kind: 'office', ...base, text, capped: text.length >= cap } : { kind: 'binary', ...base }
  } catch {
    return { kind: 'binary', ...base }
  }
}

// shortcut: text previews stop at the configured cap (200 KB default) — upgrade to a paging reader when huge logs matter.
export async function preview(p: string, maxKB = 200): Promise<Preview> {
  const cap = Math.min(8192, Math.max(16, maxKB || 200)) * 1024
  const st = await fs.stat(p)
  if (st.isDirectory()) return { kind: 'dir', size: 0, mtime: st.mtimeMs }

  const ext = path.extname(p).slice(1).toLowerCase()
  const base = { size: st.size, mtime: st.mtimeMs }
  if (IMAGE.has(ext)) return { kind: 'image', ...base }
  if (ext === 'pdf') return { kind: 'pdf', ...base }
  if (OFFICE.has(ext)) return officePreview(p, base, ext)
  if (AUDIO.has(ext)) return { kind: 'audio', ...base }
  if (VIDEO.has(ext)) return { kind: 'video', ...base }

  const fh = await fs.open(p, 'r').catch(() => null)
  if (!fh) return { kind: 'binary', ...base }
  try {
    const len = Math.min(cap, st.size)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, 0)
    if (buf.subarray(0, 4096).includes(0)) return { kind: 'binary', ...base }
    return { kind: 'text', ...base, text: buf.toString('utf8'), capped: st.size > len }
  } finally {
    await fh.close()
  }
}
