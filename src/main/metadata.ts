import { promises as fs } from 'node:fs'
import path from 'node:path'

export type Tags = {
  /** audio (ID3) */
  title?: string
  artist?: string
  album?: string
  year?: string
  track?: string
  /** image (EXIF) */
  date?: string
  camera?: string
  iso?: string
  fnumber?: string
  exposure?: string
  focal?: string
  /** shared */
  size?: string
  kind: 'id3' | 'exif' | 'both' | 'none'
}

const text = (b: Buffer, start: number, len: number, enc: number): string => {
  const slice = b.subarray(start, start + len)
  try {
    if (enc === 1) return new TextDecoder('utf-16').decode(slice).replace(/\0.*$/s, '').trim()
    if (enc === 2) return new TextDecoder('utf-16be').decode(slice).replace(/\0.*$/s, '').trim()
    return slice.toString('utf8').replace(/\0.*$/s, '').trim()
  } catch {
    return ''
  }
}

/** ID3v2.2/2.3/2.4 text frames — enough for title/artist/album/year/track. */
export function parseId3(b: Buffer): Tags {
  if (b.length < 10 || b.subarray(0, 3).toString('latin1') !== 'ID3') return { kind: 'none' }
  const major = b[3]
  const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]
  const end = Math.min(b.length, 10 + size)
  const want: Record<string, keyof Tags> = {
    TIT2: 'title',
    TT2: 'title',
    TPE1: 'artist',
    TP1: 'artist',
    TALB: 'album',
    TAL: 'album',
    TYER: 'year',
    TDRC: 'year',
    TYE: 'year',
    TRCK: 'track',
    TRK: 'track'
  }
  const out: Tags = { kind: 'id3' }
  let p = 10
  while (p + 10 <= end) {
    const id = b.subarray(p, p + (major === 2 ? 3 : 4)).toString('latin1')
    const len =
      major === 2
        ? (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5]
        : (b[p + 4] << 24) | (b[p + 5] << 16) | (b[p + 6] << 8) | b[p + 7]
    const headerLen = major === 2 ? 6 : 10
    if (!id.trim() || len <= 0 || p + headerLen + len > b.length) break
    const body = p + headerLen
    const key = want[id]
    if (key) {
      const enc = b[body]
      const value = text(b, body + 1, len - 1, enc)
      if (value) (out as Record<string, string>)[key as string] = value
    }
    p += headerLen + len
  }
  return out
}

/** EXIF IFD0/ExifIFD tags that people actually use when renaming photos. */
export function parseExif(b: Buffer): Tags {
  try {
    if (b.length < 24 || b[0] !== 0xff || b[1] !== 0xd8) return { kind: 'none' }
    let off = 2
    while (off < b.length - 4) {
      if (b[off] !== 0xff) {
        off++
        continue
      }
      const marker = b[off + 1]
      const len = b.readUInt16BE(off + 2)
      if (marker === 0xe1 && b.subarray(off + 4, off + 10).toString('latin1') === 'Exif\0\0') {
        return readTiff(b, off + 10)
      }
      if (marker === 0xda) break
      off += 2 + len
    }
    return { kind: 'none' }
  } catch {
    return { kind: 'none' }
  }
}

function readTiff(b: Buffer, base: number): Tags {
  const le = b.subarray(base, base + 2).toString('latin1') === 'II'
  const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o))
  const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o))
  if (u16(base + 2) !== 42) return { kind: 'none' }
  const out: Tags = { kind: 'exif' }
  const ascii = (valOff: number, count: number): string => {
    const start = count > 4 ? base + u32(valOff) : valOff
    return b
      .subarray(base + (count > 4 ? u32(valOff) : valOff - base), base + (count > 4 ? u32(valOff) : valOff - base) + Math.min(count, 400))
      .toString('latin1')
      .replace(/\0.*$/s, '')
      .trim() || (count > 4 ? '' : b.subarray(start, start + count).toString('latin1').trim())
  }

  const readIfd = (ifdOff: number, exifBase: number | null): number | null => {
    const count = u16(ifdOff)
    if (count > 500) return null
    let exifPointer: number | null = null
    for (let i = 0; i < count; i++) {
      const e = ifdOff + 2 + i * 12
      const tag = u16(e)
      const type = u16(e + 2)
      const n = u32(e + 4)
      const valOff = e + 8
      if (type === 2) {
        const s = ascii(valOff, n)
        if (tag === 0x010f && s) out.camera = s
        else if (tag === 0x0110 && s) out.camera = (out.camera ? out.camera + ' ' : '') + s
        else if ((tag === 0x0132 || tag === 0x9003) && s)
          // EXIF writes "2024:05:17 14:23:11"; only the date part uses colons
          out.date = s.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').slice(0, 19)
      } else if (type === 3) {
        const v = u16(valOff)
        if (tag === 0x8827) out.iso = String(v)
      } else if (type === 4) {
        const v = u32(valOff)
        if (tag === 0x829a && v) out.exposure = `1/${Math.round(1 / (v / 1_000_000))}`
      } else if (type === 5) {
        const num = u32(base + u32(valOff))
        const den = u32(base + u32(valOff) + 4)
        if (tag === 0x829d && den) out.fnumber = `f/${(num / den).toFixed(1)}`
        else if (tag === 0x920a && den) out.focal = `${Math.round(num / den)}mm`
      }
      if (tag === 0x8769) exifPointer = base + u32(valOff)
    }
    return exifPointer
  }

  const nextIfd = readIfd(base + u32(base + 4), null)
  if (nextIfd) readIfd(nextIfd, nextIfd)
  return out
}

export const isAudioTagged = (p: string) => /\.(mp3|m4a|flac|ogg|opus)$/i.test(p)
export const isImageTagged = (p: string) => /\.(jpe?g|tiff?|heic)$/i.test(p)

/** Reads whatever tags the format carries; never throws. */
export async function readTags(p: string): Promise<Tags> {
  if (!path.isAbsolute(p)) return { kind: 'none' }
  const st = await fs.stat(p).catch(() => null)
  if (!st || st.isDirectory() || st.size > 60_000_000) return { kind: 'none' }
  const ext = path.extname(p).toLowerCase()
  const head = await fs.readFile(p).catch(() => null)
  if (!head) return { kind: 'none' }
  let out: Tags = { kind: 'none' }
  if (/^\.(mp3|m4a)$/i.test(ext) || isAudioTagged(p)) {
    const id3 = parseId3(head)
    if (id3.kind !== 'none') out = id3
  }
  if (isImageTagged(p)) {
    const exif = parseExif(head)
    if (exif.kind !== 'none') out = out.kind === 'none' ? exif : { ...out, ...exif, kind: 'both' }
  }
  return out
}
