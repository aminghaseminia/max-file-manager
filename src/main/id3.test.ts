import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readId3, readId3Cover, writeId3File, writeId3Tag } from './id3.ts'

const syncsafe = (n: number) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])

const frame23 = (id: string, body: Buffer, flags = 0) => {
  const head = Buffer.alloc(10)
  head.write(id, 0, 'latin1')
  head.writeUInt32BE(body.length, 4)
  head.writeUInt16BE(flags, 8)
  return Buffer.concat([head, body])
}

const frame24 = (id: string, body: Buffer) => {
  const head = Buffer.alloc(10)
  head.write(id, 0, 'latin1')
  syncsafe(body.length).copy(head, 4)
  return Buffer.concat([head, body])
}

const text23 = (value: string) =>
  Buffer.concat([Buffer.from([1]), Buffer.from('\uFEFF' + value, 'utf16le'), Buffer.from([0, 0])])

const text24 = (value: string) => Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8'), Buffer.from([0])])

const tagOf = (major: 2 | 3 | 4, frames: Buffer[], flags = 0) => {
  const body = Buffer.concat(frames)
  const header = Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([major, 0, flags]),
    syncsafe(body.length)
  ])
  return Buffer.concat([header, body])
}

const audio = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x11, 0x22, 0x33, 0x44])

test('merge keeps the audio and every untouched/unknown frame byte-for-byte', () => {
  const ufidBody = Buffer.from([0x00, 0xde, 0xad, 0xbe, 0xef, 0xff, 0x00, 0x01])
  const ufid = frame23('UFID', ufidBody)
  const old = tagOf(3, [frame23('TIT2', text23('قدیمی')), frame23('TPE1', text23('هنرمند قدیمی')), ufid])
  const buf = Buffer.concat([old, audio])

  const out = writeId3Tag(buf, { title: 'عنوان تازه' }).buffer
  const read = readId3(out)
  assert.equal(read.fields.title, 'عنوان تازه')
  assert.equal(read.fields.artist, 'هنرمند قدیمی', 'a key that is not in the patch is untouched')
  assert.equal(read.major, 3)
  assert.ok(out.includes(ufid), 'UFID survives byte-for-byte')
  assert.deepEqual([...out.subarray(out.length - audio.length)], [...audio], 'audio bytes are copied untouched')
})

test('an empty string removes a frame; the untouched one stays', () => {
  const old = tagOf(3, [frame23('TIT2', text23('Old')), frame23('TALB', text23('Album'))])
  const buf = Buffer.concat([old, audio])
  const out = writeId3Tag(buf, { title: '' }).buffer
  const read = readId3(out)
  assert.equal(read.fields.title, undefined)
  assert.equal(read.fields.album, 'Album')
  assert.equal(out.includes(Buffer.from('TIT2', 'latin1')), false)
})

test('TRCK is "n" alone and "n/total" together', () => {
  const base = Buffer.concat([tagOf(3, []), audio])
  const only = readId3(writeId3Tag(base, { track: '3' }).buffer)
  assert.equal(only.fields.track, '3')
  assert.equal(only.fields.trackTotal, undefined)

  const both = readId3(writeId3Tag(base, { track: '3', trackTotal: '12' }).buffer)
  assert.equal(both.fields.track, '3')
  assert.equal(both.fields.trackTotal, '12')

  const cleared = readId3(writeId3Tag(writeId3Tag(base, { track: '3', trackTotal: '12' }).buffer, { trackTotal: '' }).buffer)
  assert.equal(cleared.fields.track, '3')
  assert.equal(cleared.fields.trackTotal, undefined)

  const disc = readId3(writeId3Tag(base, { disc: '1', discTotal: '2' }).buffer)
  assert.equal(disc.fields.disc, '1')
  assert.equal(disc.fields.discTotal, '2')
})

test('comment is written and read back', () => {
  const base = Buffer.concat([tagOf(3, []), audio])
  const out = writeId3Tag(base, { comment: 'سلام دنیا' }).buffer
  assert.equal(readId3(out).fields.comment, 'سلام دنیا')
  assert.ok(out.includes(Buffer.from('COMM', 'latin1')))
})

test('APIC cover is embedded and can be removed', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const base = Buffer.concat([tagOf(3, []), audio])
  const withCover = writeId3Tag(base, {}, { cover: png, coverMime: 'image/png' }).buffer
  const meta = readId3(withCover)
  assert.deepEqual(meta.cover, { mime: 'image/png', size: png.length })
  assert.deepEqual(readId3Cover(withCover)?.data, png)

  const removed = writeId3Tag(withCover, {}, { cover: 'clear' }).buffer
  assert.equal(readId3(removed).cover, null)
  assert.equal(readId3Cover(removed), null)
  assert.equal(removed.includes(Buffer.from('APIC', 'latin1')), false)
})

test('a file without a tag gets a fresh 2.3 tag', () => {
  const out = writeId3Tag(audio, { title: 'بی‌تگ', year: '1403' }).buffer
  assert.equal(out.subarray(0, 3).toString('latin1'), 'ID3')
  assert.equal(out[3], 3)
  const read = readId3(out)
  assert.equal(read.fields.title, 'بی‌تگ')
  assert.equal(read.fields.year, '1403')
  assert.deepEqual([...out.subarray(out.length - audio.length)], [...audio])
})

test('reads ID3v2.2 tags', () => {
  const head = (id: string, body: Buffer) => {
    const h = Buffer.alloc(6)
    h.write(id, 0, 'latin1')
    h.writeUIntBE(body.length, 3, 3)
    return Buffer.concat([h, body])
  }
  const buf = Buffer.concat([
    tagOf(2, [
      head('TT2', text23('Two point two')),
      head('TP1', text23('Artist')),
      head('TAL', text23('Album')),
      head('TRK', text23('2/9'))
    ]),
    audio
  ])
  const read = readId3(buf)
  assert.equal(read.major, 2)
  assert.equal(read.fields.title, 'Two point two')
  assert.equal(read.fields.artist, 'Artist')
  assert.equal(read.fields.album, 'Album')
  assert.equal(read.fields.track, '2')
  assert.equal(read.fields.trackTotal, '9')
})

test('a v2.2 tag is upgraded to 2.3 on write, keeping known text', () => {
  const head = (id: string, body: Buffer) => {
    const h = Buffer.alloc(6)
    h.write(id, 0, 'latin1')
    h.writeUIntBE(body.length, 3, 3)
    return Buffer.concat([h, body])
  }
  const buf = Buffer.concat([tagOf(2, [head('TT2', text23('Old title'))]), audio])
  const out = writeId3Tag(buf, { artist: 'New artist' }).buffer
  const read = readId3(out)
  assert.equal(read.major, 3)
  assert.equal(read.fields.title, 'Old title')
  assert.equal(read.fields.artist, 'New artist')
})

test('reads ID3v2.4 and keeps writing 2.4 with UTF-8 and syncsafe sizes', () => {
  const buf = Buffer.concat([tagOf(4, [frame24('TIT2', text24('Old'))]), audio])
  const read = readId3(buf)
  assert.equal(read.major, 4)
  assert.equal(read.fields.title, 'Old')

  const long = 'x'.repeat(200)
  const out = writeId3Tag(buf, { title: long }).buffer
  assert.equal(out[3], 4, '2.4 stays 2.4')
  assert.equal(readId3(out).fields.title, long)
  // find the fresh TIT2 frame and check its size field is syncsafe (202 = 00 00 01 4A)
  const at = out.indexOf(Buffer.from('TIT2', 'latin1'))
  assert.deepEqual([...out.subarray(at + 4, at + 8)], [0x00, 0x00, 0x01, 0x4a])
  assert.equal(out[at + 10], 3, 'v2.4 text is UTF-8 (encoding 3)')
})

test('unsynchronised and extended-header tags are read and rewritten cleanly', () => {
  const title = text23('FF title') // starts with the UTF-16 BOM 0xFF 0xFE
  const rawTag = tagOf(3, [frame23('TIT2', title)])
  const rawBody = rawTag.subarray(10)
  const unsyncedBody = Buffer.alloc(rawBody.length * 2)
  let n = 0
  for (let i = 0; i < rawBody.length; i++) {
    unsyncedBody[n++] = rawBody[i]
    if (rawBody[i] === 0xff) unsyncedBody[n++] = 0x00
  }
  const unsyncedTag = Buffer.concat([
    Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0x80]), syncsafe(n)]),
    unsyncedBody.subarray(0, n),
    audio
  ])
  assert.equal(readId3(unsyncedTag).fields.title, 'FF title')

  const extHeader = Buffer.concat([Buffer.from([0, 0, 0, 6]), Buffer.from([0, 0, 0, 0, 0, 0])])
  const frames = frame23('TIT2', text23('Extended'))
  const extBody = Buffer.concat([extHeader, frames])
  const extTag = Buffer.concat([
    Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0x40]), syncsafe(extBody.length)]),
    extBody,
    audio
  ])
  assert.equal(readId3(extTag).fields.title, 'Extended')

  const out = writeId3Tag(unsyncedTag, { artist: 'Clean' }).buffer
  assert.equal(out[5], 0, 'the rewritten tag is not unsynchronised')
  assert.equal(readId3(out).fields.title, 'FF title')
  assert.equal(readId3(out).fields.artist, 'Clean')
})

test('a v2.4 footer counts towards the audio start', () => {
  const frames = frame24('TIT2', text24('Footer'))
  const body = Buffer.concat([frames])
  const header = Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([4, 0, 0x10]),
    syncsafe(body.length)
  ])
  const footer = Buffer.concat([Buffer.from('3DI', 'latin1'), Buffer.from([4, 0, 0x10]), syncsafe(body.length)])
  const buf = Buffer.concat([header, body, footer, audio])
  const read = readId3(buf)
  assert.equal(read.fields.title, 'Footer')
  const out = writeId3Tag(buf, { artist: 'After footer' }).buffer
  assert.deepEqual([...out.subarray(out.length - audio.length)], [...audio])
})

test('an ID3v1 trailer is updated and keeps its genre byte', async () => {
  const v1 = Buffer.alloc(128)
  v1.write('TAG', 0, 'latin1')
  v1.write('Old', 3, 'latin1')
  v1[127] = 17 // genre: Rock
  const file = Buffer.concat([tagOf(3, []), audio, v1])
  const out = writeId3Tag(file, { title: 'V1', artist: 'Artist', year: '2020', track: '7', comment: 'note' })
    .buffer
  const tail = out.subarray(out.length - 128)
  assert.equal(tail.subarray(0, 3).toString('latin1'), 'TAG')
  assert.equal(tail.subarray(3, 5).toString('latin1'), 'V1')
  assert.equal(tail.subarray(33, 39).toString('latin1'), 'Artist')
  assert.equal(tail.subarray(93, 97).toString('latin1'), '2020')
  assert.equal(tail[126], 7)
  assert.equal(tail[127], 17, 'genre byte survives')
})

test('readId3 never throws on garbage', () => {
  for (const b of [Buffer.alloc(0), Buffer.from('hello'), Buffer.from('ID3'), Buffer.alloc(30, 0xff)]) {
    const r = readId3(b)
    assert.equal(r.cover, null)
    assert.deepEqual(r.fields, {})
  }
})

test('writeId3File is atomic, keeps the mode and rejects bad paths', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-id3-'))
  const file = path.join(dir, 'song.mp3')
  await fs.writeFile(file, Buffer.concat([tagOf(3, []), audio]), { mode: 0o640 })
  const r = await writeId3File(file, { title: 'Atomic' })
  assert.deepEqual(r, { ok: true })
  assert.equal(readId3(await fs.readFile(file)).fields.title, 'Atomic')
  assert.equal((await fs.stat(file)).mode & 0o777, 0o640)
  assert.deepEqual(await writeId3File('relative.mp3', { title: 'x' }), { error: 'مسیر نامعتبر' })
  assert.deepEqual(await writeId3File(dir, { title: 'x' }), { error: 'فایل خوانده نشد' })
})
