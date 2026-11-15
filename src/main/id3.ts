import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * ID3v2.2/2.3/2.4 reader and writer.
 *
 * The writer merges instead of replacing: keys that are not in the patch keep their frames
 * byte-for-byte (including unknown ones such as UFID/TXXX/PRIV/USLT), an empty string removes a
 * frame, and only the bytes after the tag are copied as audio. Pure — no I/O — so the whole thing
 * runs in `node --test` without Electron; `writeId3File` is the only function that touches disk.
 */
export type Id3Fields = {
  title?: string
  artist?: string
  albumArtist?: string
  album?: string
  year?: string
  track?: string
  trackTotal?: string
  disc?: string
  discTotal?: string
  genre?: string
  composer?: string
  comment?: string
}

export type Id3Read = {
  fields: Id3Fields
  cover: { mime: string; size: number } | null
  major: 2 | 3 | 4
}

const MAX_FILE = 200 * 1024 * 1024

type Frame = {
  id: string
  /** frame data (BOM included for UTF-16 text) */
  body: Buffer
  flags: number
  /** the exact bytes of header+body, used when a frame is carried over untouched */
  raw: Buffer
}

type ParsedTag = {
  major: 2 | 3 | 4
  frames: Frame[]
  audioStart: number
  unsync: boolean
  extended: boolean
  footer: boolean
  malformed: boolean
}

type Cover = { mime: string; data: Buffer; type: number }

const readSyncsafe = (b: Buffer, at: number): number =>
  ((b[at] & 0x7f) << 21) | ((b[at + 1] & 0x7f) << 14) | ((b[at + 2] & 0x7f) << 7) | (b[at + 3] & 0x7f)

const syncsafeBytes = (n: number): Buffer =>
  Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])

/** `FF 00` back to `FF` — used for the whole tag body and for individually unsynced v2.4 frames. */
function deUnsync(b: Buffer): Buffer {
  const out = Buffer.alloc(b.length)
  let n = 0
  for (let i = 0; i < b.length; i++) {
    out[n++] = b[i]
    if (b[i] === 0xff && b[i + 1] === 0x00) i++
  }
  return out.subarray(0, n)
}

function frameBytes(id: string, body: Buffer, major: 3 | 4, flags = 0): Buffer {
  const head = Buffer.alloc(10)
  head.write(id, 0, 'latin1')
  if (major === 4) syncsafeBytes(body.length).copy(head, 4)
  else head.writeUInt32BE(body.length, 4)
  head.writeUInt16BE(flags & 0x7fff, 8)
  return Buffer.concat([head, body])
}

function parseFrames(body: Buffer, major: 2 | 3 | 4): { frames: Frame[]; malformed: boolean } {
  const frames: Frame[] = []
  const headerLen = major === 2 ? 6 : 10
  const idLen = major === 2 ? 3 : 4
  let p = 0
  let malformed = false
  while (p + headerLen <= body.length) {
    if (body[p] === 0) break // padding starts at the first zero byte
    const id = body.subarray(p, p + idLen).toString('latin1')
    if (!/^[A-Z0-9]+$/.test(id)) break
    let size: number
    if (major === 2) size = (body[p + 3] << 16) | (body[p + 4] << 8) | body[p + 5]
    else if (major === 3) size = body.readUInt32BE(p + 4)
    else {
      const anyHigh = (body[p + 4] | body[p + 5] | body[p + 6] | body[p + 7]) & 0x80
      // a few writers store plain big-endian sizes even in 2.4; accept both
      size = anyHigh ? body.readUInt32BE(p + 4) : readSyncsafe(body, p + 4)
    }
    const flags = major === 2 ? 0 : body.readUInt16BE(p + 8)
    const start = p + headerLen
    if (size < 0 || start + size > body.length) {
      malformed = true
      break
    }
    let frameBody = body.subarray(start, start + size)
    let cleanFlags = flags
    let raw = body.subarray(p, start + size)
    if (major === 4 && (flags & 0x02) !== 0) {
      frameBody = deUnsync(frameBody)
      cleanFlags = flags & ~0x02
      raw = frameBytes(id, frameBody, 4, cleanFlags)
    }
    frames.push({ id, body: frameBody, flags: cleanFlags, raw })
    p = start + size
  }
  return { frames, malformed }
}

function parseTag(buf: Buffer): ParsedTag | null {
  if (buf.length < 10 || buf.subarray(0, 3).toString('latin1') !== 'ID3') return null
  const rawMajor = buf[3]
  if (rawMajor !== 2 && rawMajor !== 3 && rawMajor !== 4) return null
  const major = rawMajor as 2 | 3 | 4
  const flags = buf[5]
  const declared = readSyncsafe(buf, 6)
  const footer = major === 4 && (flags & 0x10) !== 0
  const unsync = (flags & 0x80) !== 0
  const extended = (flags & 0x40) !== 0
  const audioStart = Math.min(buf.length, 10 + declared + (footer ? 10 : 0))
  let body = buf.subarray(10, Math.min(buf.length, 10 + declared))
  if (unsync) body = deUnsync(body)
  if (extended && body.length >= 4) {
    // 2.4: syncsafe size that includes itself; 2.3: plain BE size that excludes the 4 size bytes
    const skip = major === 4 ? readSyncsafe(body, 0) : 4 + body.readUInt32BE(0)
    body = body.subarray(Math.min(body.length, Math.max(0, skip)))
  }
  const parsed = parseFrames(body, major)
  return { major, frames: parsed.frames, audioStart, unsync, extended, footer, malformed: parsed.malformed }
}

function decodeText(b: Buffer, enc: number): string {
  if (!b.length) return ''
  let s: string
  try {
    if (enc === 1 || enc === 2) {
      let le = enc === 1
      let start = 0
      if (enc === 1 && b.length >= 2) {
        if (b[0] === 0xff && b[1] === 0xfe) start = 2
        else if (b[0] === 0xfe && b[1] === 0xff) {
          le = false
          start = 2
        }
      }
      s = new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(b.subarray(start))
    } else s = b.toString(enc === 3 ? 'utf8' : 'latin1')
  } catch {
    s = b.toString('utf8')
  }
  return s.replace(/\0.*$/s, '').trim()
}

const textOf = (f: Frame): string => (f.body.length ? decodeText(f.body.subarray(1), f.body[0]) : '')

function commentOf(f: Frame): { lang: string; text: string } {
  if (f.body.length < 4) return { lang: 'eng', text: '' }
  const enc = f.body[0]
  const lang = f.body.subarray(1, 4).toString('latin1') || 'eng'
  let p = 4
  if (enc === 1 || enc === 2) {
    while (p + 1 < f.body.length) {
      if (f.body[p] === 0 && f.body[p + 1] === 0) {
        p += 2
        break
      }
      p += 2
    }
  } else {
    const z = f.body.indexOf(0, p)
    p = z === -1 ? p : z + 1
  }
  return { lang, text: decodeText(f.body.subarray(p), enc) }
}

function normalizeMime(mime: string, data: Buffer): string {
  const m = mime.trim().toLowerCase()
  if (!m || m === 'image/jpg' || m === 'jpeg' || m === 'jpg') {
    return data[0] === 0x89 && data[1] === 0x50 ? 'image/png' : 'image/jpeg'
  }
  if (m === 'png') return 'image/png'
  if (m === 'webp') return 'image/webp'
  if (m.startsWith('image/')) return m
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png'
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg'
  return 'image/jpeg'
}

function coverOf(f: Frame, major: 2 | 3 | 4): Cover | null {
  const b = f.body
  if (b.length < 5) return null
  const enc = b[0]
  let mime = ''
  let p: number
  if (major === 2) {
    const fmt = b.subarray(1, 4).toString('latin1').trim().toUpperCase()
    mime = fmt === 'PNG' ? 'image/png' : fmt === 'JPG' || fmt === 'JPEG' ? 'image/jpeg' : ''
    p = 4
  } else {
    const z = b.indexOf(0, 1)
    mime = b.subarray(1, z === -1 ? b.length : z).toString('latin1')
    p = z === -1 ? b.length : z + 1
  }
  if (p >= b.length) return null
  const type = b[p]
  p += 1
  if (enc === 1 || enc === 2) {
    while (p + 1 < b.length) {
      if (b[p] === 0 && b[p + 1] === 0) {
        p += 2
        break
      }
      p += 2
    }
  } else {
    const z = b.indexOf(0, p)
    p = z === -1 ? p : z + 1
  }
  const data = b.subarray(p)
  if (!data.length) return null
  return { mime: normalizeMime(mime, data), data, type }
}

function fieldsOf(frames: Frame[]): Id3Fields {
  const out: Id3Fields = {}
  let year = ''
  let dateYear = ''
  let comment = ''
  for (const f of frames) {
    switch (f.id) {
      case 'TIT2':
      case 'TT2':
        out.title ||= textOf(f)
        break
      case 'TPE1':
      case 'TP1':
        out.artist ||= textOf(f)
        break
      case 'TPE2':
      case 'TP2':
        out.albumArtist ||= textOf(f)
        break
      case 'TALB':
      case 'TAL':
        out.album ||= textOf(f)
        break
      case 'TYER':
      case 'TYE':
        year = textOf(f)
        break
      case 'TDRC':
        dateYear = textOf(f)
        break
      case 'TRCK':
      case 'TRK': {
        const [n, total] = textOf(f).split('/')
        if (n?.trim()) out.track = n.trim()
        if (total?.trim()) out.trackTotal = total.trim()
        break
      }
      case 'TPOS':
      case 'TPA': {
        const [n, total] = textOf(f).split('/')
        if (n?.trim()) out.disc = n.trim()
        if (total?.trim()) out.discTotal = total.trim()
        break
      }
      case 'TCON':
      case 'TCO':
        out.genre ||= textOf(f)
        break
      case 'TCOM':
      case 'TCM':
        out.composer ||= textOf(f)
        break
      case 'COMM':
      case 'COM': {
        const c = commentOf(f)
        if (!comment && c.text) comment = c.text
        break
      }
    }
  }
  const y = dateYear || year
  if (y) out.year = y
  if (comment) out.comment = comment
  return out
}

function pickCover(frames: Frame[], major: 2 | 3 | 4): Cover | null {
  let first: Cover | null = null
  let front: Cover | null = null
  for (const f of frames) {
    if (f.id !== 'APIC' && f.id !== 'PIC') continue
    const c = coverOf(f, major)
    if (!c) continue
    if (!first) first = c
    if (c.type === 3) {
      front = c
      break
    }
  }
  return front ?? first
}

/** Reads the text fields and the cover description; never throws. */
export function readId3(buf: Buffer): Id3Read {
  try {
    const tag = parseTag(buf)
    if (!tag) return { fields: {}, cover: null, major: 3 }
    const cover = pickCover(tag.frames, tag.major)
    return {
      fields: fieldsOf(tag.frames),
      cover: cover ? { mime: cover.mime, size: cover.data.length } : null,
      major: tag.major
    }
  } catch {
    return { fields: {}, cover: null, major: 3 }
  }
}

/** The embedded picture itself, for the UI and for MCP `tags_cover`. */
export function readId3Cover(buf: Buffer): { mime: string; data: Buffer } | null {
  try {
    const tag = parseTag(buf)
    if (!tag) return null
    const cover = pickCover(tag.frames, tag.major)
    return cover ? { mime: cover.mime, data: cover.data } : null
  } catch {
    return null
  }
}

function textBody(value: string, major: 3 | 4): Buffer {
  if (major === 4) return Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8'), Buffer.from([0])])
  return Buffer.concat([Buffer.from([1]), Buffer.from('\uFEFF' + value, 'utf16le'), Buffer.from([0, 0])])
}

function commentBody(value: string, major: 3 | 4, lang = 'eng'): Buffer {
  const text = major === 4 ? Buffer.from(value, 'utf8') : Buffer.from('\uFEFF' + value, 'utf16le')
  const desc = major === 4 ? Buffer.from([0]) : Buffer.from([0xff, 0xfe, 0, 0])
  return Buffer.concat([Buffer.from([major === 4 ? 3 : 1]), Buffer.from(lang, 'latin1'), desc, text])
}

function apicBody(data: Buffer, mime: string, major: 3 | 4): Buffer {
  const enc = major === 4 ? 3 : 1
  const description = major === 4 ? Buffer.from([0]) : Buffer.from([0xff, 0xfe, 0, 0])
  return Buffer.concat([
    Buffer.from([enc]),
    Buffer.from(normalizeMime(mime, data), 'latin1'),
    Buffer.from([0, 3]),
    description,
    data
  ])
}

function idsForKey(key: keyof Id3Fields, major: 3 | 4): string[] {
  switch (key) {
    case 'title':
      return ['TIT2']
    case 'artist':
      return ['TPE1']
    case 'albumArtist':
      return ['TPE2']
    case 'album':
      return ['TALB']
    case 'year':
      return major === 4 ? ['TDRC', 'TYER'] : ['TYER', 'TDRC']
    case 'track':
    case 'trackTotal':
      return ['TRCK']
    case 'disc':
    case 'discTotal':
      return ['TPOS']
    case 'genre':
      return ['TCON']
    case 'composer':
      return ['TCOM']
    case 'comment':
      return ['COMM']
  }
}

function newFrameId(key: keyof Id3Fields, major: 3 | 4): string {
  return idsForKey(key, major)[0]
}

/** v2.2 frame id → its v2.3/2.4 successor, for the one-way upgrade the spec allows. */
const V22_IDS: Record<string, string> = {
  TT2: 'TIT2',
  TP1: 'TPE1',
  TP2: 'TPE2',
  TAL: 'TALB',
  TYE: 'TYER',
  TRK: 'TRCK',
  TPA: 'TPOS',
  TCO: 'TCON',
  TCM: 'TCOM',
  COM: 'COMM',
  PIC: 'APIC'
}

/** Upgrade one v2.2 frame to the target output version; null means "not transferable". */
function upgradeV22(f: Frame, major: 3 | 4): { id: string; body: Buffer } | null {
  const id = V22_IDS[f.id]
  if (!id) return null
  if (id === 'APIC') {
    const c = coverOf(f, 2)
    return c ? { id: 'APIC', body: apicBody(c.data, c.mime, major) } : null
  }
  if (id === 'COMM') {
    const c = commentOf(f)
    return c.text ? { id: 'COMM', body: commentBody(c.text, major, c.lang) } : null
  }
  if (id === 'TYER') return { id: newFrameId('year', major), body: textBody(textOf(f), major) }
  return { id, body: textBody(textOf(f), major) }
}

export function writeId3Tag(
  buf: Buffer,
  patch: Id3Fields,
  opts?: { cover?: Buffer | 'clear'; coverMime?: string }
): { buffer: Buffer; stripped?: string } {
  const tag = parseTag(buf)
  const major: 3 | 4 = tag && tag.major === 4 ? 4 : 3
  const audioStart = tag ? tag.audioStart : 0
  const audio = buf.subarray(Math.min(audioStart, buf.length))
  const existing = tag ? fieldsOf(tag.frames) : {}

  const touched = new Set<string>()
  const added: { id: string; body: Buffer }[] = []

  const textKeys: (keyof Id3Fields)[] = ['title', 'artist', 'albumArtist', 'album', 'year', 'genre', 'composer', 'comment']
  for (const key of textKeys) {
    const value = patch[key]
    if (value === undefined) continue
    for (const id of idsForKey(key, major)) touched.add(id)
    const text = String(value).trim()
    if (!text) continue
    added.push({
      id: newFrameId(key, major),
      body: key === 'comment' ? commentBody(text, major) : textBody(text, major)
    })
  }

  // numbers are written as "n" or "n/total"; an untouched total stays as it was
  const numberPairs: { key: 'track' | 'disc'; total: 'trackTotal' | 'discTotal'; id: string }[] = [
    { key: 'track', total: 'trackTotal', id: 'TRCK' },
    { key: 'disc', total: 'discTotal', id: 'TPOS' }
  ]
  for (const pair of numberPairs) {
    if (patch[pair.key] === undefined && patch[pair.total] === undefined) continue
    touched.add(pair.id)
    const n = patch[pair.key] !== undefined ? String(patch[pair.key]).trim() : (existing[pair.key] ?? '')
    const total =
      patch[pair.total] !== undefined ? String(patch[pair.total]).trim() : (existing[pair.total] ?? '')
    const value = n ? (total ? `${n}/${total}` : n) : total ? `0/${total}` : ''
    if (value) added.push({ id: pair.id, body: textBody(value, major) })
  }

  if (opts?.cover !== undefined) {
    touched.add('APIC')
    touched.add('PIC')
    if (Buffer.isBuffer(opts.cover) && opts.cover.length) {
      added.push({ id: 'APIC', body: apicBody(opts.cover, opts.coverMime ?? 'image/jpeg', major) })
    }
  }

  const kept: Buffer[] = []
  let droppedV22 = 0
  if (tag) {
    for (const f of tag.frames) {
      if (tag.major === major) {
        if (touched.has(f.id)) continue
        kept.push(f.raw)
      } else {
        const up = upgradeV22(f, major)
        if (!up) {
          droppedV22++
          continue
        }
        if (touched.has(up.id) || touched.has(f.id)) continue
        kept.push(frameBytes(up.id, up.body, major))
      }
    }
  }

  const body = Buffer.concat([...kept, ...added.map((a) => frameBytes(a.id, a.body, major))])
  const header = Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([major, 0, 0]),
    syncsafeBytes(body.length)
  ])
  const fresh = Buffer.concat([header, body])
  let out: Buffer = Buffer.concat([fresh, audio])

  // an ID3v1 trailer beside the v2 tag stays valid and in sync, genre byte untouched
  if (out.length >= 128 && out.subarray(out.length - 128, out.length - 125).toString('latin1') === 'TAG') {
    const finalFields = readId3(fresh).fields
    out = updateId3v1(out, finalFields)
  }

  const notes: string[] = []
  if (droppedV22) notes.push('فریم‌های ناشناس ID3v2.2 قابل انتقال نبودند و حذف شدند')
  if (tag?.malformed) notes.push('بخشی از فریم‌های تگ قبلی ناخوانا بود و حذف شد')
  return notes.length ? { buffer: out, stripped: notes.join('؛ ') } : { buffer: out }
}

function latin1Into(tag: Buffer, value: string | undefined, offset: number, length: number): void {
  tag.fill(0, offset, offset + length)
  if (!value) return
  tag.write(value.slice(0, length), offset, 'latin1')
}

function updateId3v1(out: Buffer, fields: Id3Fields): Buffer {
  const copy = Buffer.from(out)
  const base = copy.length - 128
  const tag = copy.subarray(base)
  latin1Into(tag, fields.title, 3, 30)
  latin1Into(tag, fields.artist, 33, 30)
  latin1Into(tag, fields.album, 63, 30)
  latin1Into(tag, fields.year, 93, 4)
  const match = /^\d{1,3}/.exec(fields.track ?? '')
  // v1.1 layout: 28 comment bytes, a zero byte, the track number, then the genre byte
  latin1Into(tag, fields.comment, 97, 28)
  tag[125] = 0
  tag[126] = match ? Math.min(255, Number(match[0])) : 0
  return copy
}

/** Atomic write: temp file beside the original, then rename, keeping the original mode. */
export async function writeId3File(
  p: string,
  patch: Id3Fields,
  opts?: { cover?: Buffer | 'clear'; coverMime?: string }
): Promise<{ ok: true } | { error: string }> {
  if (!path.isAbsolute(p)) return { error: 'مسیر نامعتبر' }
  const st = await fs.stat(p).catch(() => null)
  if (!st || st.isDirectory()) return { error: 'فایل خوانده نشد' }
  if (st.size > MAX_FILE) return { error: 'فایل بزرگ‌تر از ۲۰۰ مگابایت است' }
  const buf = await fs.readFile(p).catch(() => null)
  if (!buf) return { error: 'فایل خوانده نشد' }
  let buffer: Buffer
  try {
    buffer = writeId3Tag(buf, patch, opts).buffer
  } catch (e) {
    return { error: String(e instanceof Error ? e.message : e) }
  }
  const tmp = `${p}.mfm-tmp-${process.pid}`
  try {
    await fs.writeFile(tmp, buffer)
    await fs.chmod(tmp, st.mode & 0o7777)
    await fs.rename(tmp, p)
    return { ok: true }
  } catch (e) {
    await fs.rm(tmp, { force: true })
    return { error: String(e instanceof Error ? e.message : e) }
  }
}
