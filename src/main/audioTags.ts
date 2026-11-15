import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { readId3, readId3Cover, writeId3File, writeId3Tag, type Id3Fields } from './id3.ts'

/**
 * Batch audio tags for mp3 files: reading the shared/folder cover for the editor, and writing a
 * whole selection through `id3.ts` (never a second tag implementation).
 */
export type AudioRead = {
  files: Record<string, Id3Fields>
  hasCover: Record<string, boolean>
  /** data URL only when every selected file carries the very same cover bytes */
  sharedCover: string | null
  /** first cover/folder/album/artwork image in the folder of the first file */
  folderCover: string | null
  skipped: number
}

export type AudioWriteRequest = {
  items: { path: string; fields: Id3Fields }[]
  cover: 'keep' | 'clear' | 'folder' | { path: string }
}

export type AudioWriteResult = {
  done: number
  errors: string[]
  /** non-fatal losses, e.g. unreadable unknown ID3v2.2 frames */
  warnings?: string[]
}

const MAX_FILES = 200
const MAX_READ = 200 * 1024 * 1024
const MAX_COVER = 8 * 1024 * 1024
const COVER_BASES = ['cover', 'folder', 'album', 'artwork']
const COVER_EXTS = ['.jpg', '.jpeg', '.png', '.webp']
const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

const isMp3 = (p: string): boolean => /\.mp3$/i.test(p)
const dataUrl = (mime: string, data: Buffer): string => `data:${mime};base64,${data.toString('base64')}`

const FIELD_KEYS: (keyof Id3Fields)[] = [
  'title',
  'artist',
  'albumArtist',
  'album',
  'year',
  'track',
  'trackTotal',
  'disc',
  'discTotal',
  'genre',
  'composer',
  'comment'
]

/** Unknown keys are ignored; a string value is written, an empty string removes the frame. */
export function cleanAudioFields(raw: unknown): Id3Fields {
  const out: Id3Fields = {}
  if (!raw || typeof raw !== 'object') return out
  for (const key of FIELD_KEYS) {
    const value = (raw as Record<string, unknown>)[key]
    if (typeof value === 'string') out[key] = value
  }
  return out
}

async function loadImage(p: string): Promise<{ data: Buffer; mime: string } | { error: string }> {
  if (!path.isAbsolute(p)) return { error: 'مسیر نامعتبر' }
  const mime = IMAGE_MIME[path.extname(p).toLowerCase()]
  if (!mime) return { error: 'پسوند تصویر پشتیبانی نمی‌شود' }
  const st = await fs.stat(p).catch(() => null)
  if (!st || !st.isFile()) return { error: 'فایل تصویر پیدا نشد' }
  if (st.size > MAX_COVER) return { error: 'تصویر بزرگ‌تر از ۸ مگابایت است' }
  const data = await fs.readFile(p).catch(() => null)
  if (!data) return { error: 'تصویر خوانده نشد' }
  return { data, mime }
}

/**
 * cover/folder/album/artwork.(jpg|jpeg|png|webp) beside the song — deterministic order, and the
 * comparison is case-insensitive because users rename these files all the time.
 */
export async function findFolderCover(file: string): Promise<string | null> {
  const dir = path.dirname(file)
  const names = await fs.readdir(dir).catch(() => null)
  if (!names) return null
  const candidates: { path: string; rank: number }[] = []
  for (const name of names) {
    const ext = path.extname(name).toLowerCase()
    const base = path.basename(name, path.extname(name)).toLowerCase()
    const baseRank = COVER_BASES.indexOf(base)
    const extRank = COVER_EXTS.indexOf(ext)
    if (baseRank < 0 || extRank < 0) continue
    candidates.push({ path: path.join(dir, name), rank: baseRank * 10 + extRank })
  }
  candidates.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path))
  for (const candidate of candidates) {
    const st = await fs.stat(candidate.path).catch(() => null)
    if (st?.isFile()) return candidate.path
  }
  return null
}

async function folderCoverUrl(file: string): Promise<string | null> {
  const image = await findFolderCover(file)
  if (!image) return null
  const loaded = await loadImage(image)
  return 'error' in loaded ? null : dataUrl(loaded.mime, loaded.data)
}

async function readTagFile(p: string): Promise<Buffer | null> {
  const st = await fs.stat(p).catch(() => null)
  if (!st || st.isDirectory() || st.size > MAX_READ) return null
  return fs.readFile(p).catch(() => null)
}

/** Reads the tag of one file (metadata only, cover bytes stay here). */
export async function readAudioTags(paths: string[]): Promise<AudioRead> {
  const all = (Array.isArray(paths) ? paths : []).filter((p): p is string => typeof p === 'string')
  const listed = all.slice(0, MAX_FILES)
  let skipped = Math.max(0, all.length - listed.length)
  const files: Record<string, Id3Fields> = {}
  const hasCover: Record<string, boolean> = {}
  const accepted: string[] = []
  for (const p of listed) {
    if (!path.isAbsolute(p) || !isMp3(p)) {
      skipped++
      continue
    }
    accepted.push(p)
  }
  const coverData: { mime: string; data: Buffer }[] = []
  for (const p of accepted) {
    const buf = await readTagFile(p)
    const read = buf ? readId3(buf) : { fields: {}, cover: null, major: 3 as const }
    files[p] = read.fields
    hasCover[p] = read.cover !== null
    if (buf && read.cover) {
      const cover = readId3Cover(buf)
      if (cover) coverData.push(cover)
    }
  }
  let sharedCover: string | null = null
  if (accepted.length && coverData.length === accepted.length) {
    const hash = (b: Buffer) => createHash('sha1').update(b).digest('hex')
    const first = coverData[0]
    const firstHash = hash(first.data)
    if (coverData.every((c) => hash(c.data) === firstHash)) sharedCover = dataUrl(first.mime, first.data)
  }
  const folderCover = accepted.length ? await folderCoverUrl(accepted[0]) : null
  return { files, hasCover, sharedCover, folderCover, skipped }
}

/** Only the header is read here; full files are read just to report a dropped v2.2 frame. */
async function needsStripNotice(p: string): Promise<boolean> {
  let fh: FileHandle | null = null
  try {
    fh = await fs.open(p, 'r')
    const head = Buffer.alloc(10)
    const { bytesRead } = await fh.read(head, 0, 10, 0)
    if (bytesRead < 10 || head.subarray(0, 3).toString('latin1') !== 'ID3') return false
    const major = head[3]
    const flags = head[5]
    return major === 2 || (flags & 0xc0) !== 0 || (major === 4 && (flags & 0x10) !== 0)
  } catch {
    return false
  } finally {
    await fh?.close()
  }
}

/** Writes the same merged tag to every item; invalid entries become per-file errors, never throws. */
export async function writeAudioTags(req: AudioWriteRequest): Promise<AudioWriteResult> {
  const items = Array.isArray(req?.items) ? req.items.slice(0, 1000) : []
  const errors: string[] = []
  const warnings: string[] = []
  let done = 0
  const coverMode = req?.cover ?? 'keep'

  let sharedImage: { data: Buffer; mime: string } | null = null
  if (coverMode && typeof coverMode === 'object' && typeof coverMode.path === 'string') {
    const loaded = await loadImage(coverMode.path)
    if ('error' in loaded) return { done: 0, errors: [`کاور: ${loaded.error}`] }
    sharedImage = loaded
  }

  for (const item of items) {
    const p = item?.path
    if (typeof p !== 'string' || !path.isAbsolute(p)) {
      errors.push(`${p ? path.basename(p) : '?'}: مسیر نامعتبر`)
      continue
    }
    if (!isMp3(p)) {
      errors.push(`${path.basename(p)}: فقط فایل mp3 پشتیبانی می‌شود`)
      continue
    }
    let opts: { cover?: Buffer | 'clear'; coverMime?: string } | undefined
    if (coverMode === 'clear') opts = { cover: 'clear' }
    else if (coverMode === 'folder') {
      const image = await findFolderCover(p)
      if (!image) {
        errors.push(`${path.basename(p)}: کاور پوشه پیدا نشد`)
        continue
      }
      const loaded = await loadImage(image)
      if ('error' in loaded) {
        errors.push(`${path.basename(p)}: ${loaded.error}`)
        continue
      }
      opts = { cover: loaded.data, coverMime: loaded.mime }
    } else if (sharedImage) {
      opts = { cover: sharedImage.data, coverMime: sharedImage.mime }
    }

    const fields = cleanAudioFields(item.fields)
    // an item with nothing to change is a no-op on disk, but still a success
    if (!Object.keys(fields).length && !opts) {
      const st = await fs.stat(p).catch(() => null)
      if (st?.isFile()) done++
      else errors.push(`${path.basename(p)}: فایل خوانده نشد`)
      continue
    }

    if (await needsStripNotice(p)) {
      const buf = await readTagFile(p)
      if (buf) {
        const stripped = writeId3Tag(buf, fields, opts).stripped
        if (stripped) warnings.push(`${path.basename(p)}: ${stripped}`)
      }
    }

    const result = await writeId3File(p, fields, opts)
    if ('ok' in result) done++
    else errors.push(`${path.basename(p)}: ${result.error}`)
  }

  const out: AudioWriteResult = { done, errors }
  if (warnings.length) out.warnings = warnings
  return out
}

/** The embedded cover bytes, for MCP `tags_cover`. */
export async function readAudioCover(p: string): Promise<{ mime: string; data: Buffer } | null> {
  const buf = await readTagFile(p)
  return buf ? readId3Cover(buf) : null
}
