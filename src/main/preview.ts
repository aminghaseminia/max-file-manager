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
  try {
    const zip = unzipSync(new Uint8Array(buf), {
      filter: (f) =>
        /^(word\/document\.xml|xl\/sharedStrings\.xml|xl\/worksheets\/sheet1\.xml|ppt\/slides\/slide\d+\.xml|content\.xml)$/.test(
          f.name
        )
    })
    const parts: string[] = []
    for (const [name, data] of Object.entries(zip)) {
      const xml = Buffer.from(data).toString('utf8')
      const text = xml
        .replace(/<w:p[ >]/g, '\n<w:p ')
        .replace(/<\/a:p>/g, '\n')
        .replace(/<\/text:p>/g, '\n')
        .replace(/<\/row>/g, '\n')
        .replace(/<\/si>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      if (text) parts.push(`— ${name} —\n${text}`)
      if (parts.join('\n').length > cap) break
    }
    const text = parts.join('\n\n').slice(0, cap)
    return { kind: 'office', ...base, text, capped: text.length >= cap }
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
