import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseId3, writeId3 } from './metadata.ts'

const frame = (id: string, value: string) => {
  const body = Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8'), Buffer.from([0])])
  const head = Buffer.alloc(10)
  head.write(id, 0, 'latin1')
  head.writeUInt32BE(body.length, 4)
  return Buffer.concat([head, body])
}

test('writeId3 replaces an old tag and keeps the audio bytes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-id3-'))
  const file = path.join(dir, 'song.mp3')
  const old = frame('TIT2', 'قدیمی')
  const header = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0]), Buffer.from([0, 0, 0, old.length])])
  const audio = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4])
  await fs.writeFile(file, Buffer.concat([header, old, audio]))

  const r = await writeId3(file, { title: 'عنوان تازه', artist: 'هنرمند', album: 'آلبوم', year: '1403' })
  assert.deepEqual(r, { ok: true })

  const buf = await fs.readFile(file)
  const tags = parseId3(buf)
  assert.equal(tags.title, 'عنوان تازه')
  assert.equal(tags.artist, 'هنرمند')
  assert.equal(tags.album, 'آلبوم')
  assert.equal(tags.year, '1403')
  assert.deepEqual([...buf.subarray(buf.length - audio.length)], [...audio], 'audio survives untouched')
})

test('writeId3 creates a tag when the file had none', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-id3b-'))
  const file = path.join(dir, 'raw.mp3')
  await fs.writeFile(file, Buffer.from([0xff, 0xfb, 0x90, 0x00, 9, 9]))
  await writeId3(file, { title: 'بدون تگ قبلی' })
  const tags = parseId3(await fs.readFile(file))
  assert.equal(tags.title, 'بدون تگ قبلی')
})
