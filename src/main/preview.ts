import { promises as fs } from 'node:fs'
import path from 'node:path'

export type PreviewKind = 'dir' | 'text' | 'image' | 'audio' | 'video' | 'binary'
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

const TEXT_CAP = 200 * 1024

// shortcut: text previews stop at 200 KB and images above the cap are not inlined; upgrade to a paging reader when huge logs matter.
export async function preview(p: string): Promise<Preview> {
  const st = await fs.stat(p)
  if (st.isDirectory()) return { kind: 'dir', size: 0, mtime: st.mtimeMs }

  const ext = path.extname(p).slice(1).toLowerCase()
  const base = { size: st.size, mtime: st.mtimeMs }
  if (IMAGE.has(ext)) return { kind: 'image', ...base }
  if (AUDIO.has(ext)) return { kind: 'audio', ...base }
  if (VIDEO.has(ext)) return { kind: 'video', ...base }

  const fh = await fs.open(p, 'r').catch(() => null)
  if (!fh) return { kind: 'binary', ...base }
  try {
    const len = Math.min(TEXT_CAP, st.size)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, 0)
    if (buf.subarray(0, 4096).includes(0)) return { kind: 'binary', ...base }
    return { kind: 'text', ...base, text: buf.toString('utf8'), capped: st.size > len }
  } finally {
    await fh.close()
  }
}
