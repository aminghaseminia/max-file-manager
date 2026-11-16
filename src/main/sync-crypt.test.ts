import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  decryptFile,
  encryptFile,
  generateKeypair,
  hashPlaintext,
  looksLikeIdentity,
  looksLikeRecipient,
  recipientOf
} from './sync-crypt.ts'

const sha = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex')

test('age: a keypair round-trips a file and the recipient matches the identity', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-age-'))
  try {
    const { identity, recipient } = await generateKeypair()
    assert.equal(await recipientOf(identity), recipient)
    assert.equal(looksLikeRecipient(recipient), true)
    assert.equal(looksLikeIdentity(identity), true)
    const src = path.join(dir, 'plain.txt')
    const cipher = path.join(dir, 'cipher.age')
    const back = path.join(dir, 'back.txt')
    await fs.writeFile(src, 'hello age')
    await encryptFile(src, cipher, { mode: 'keypair', recipient })
    // the ciphertext is not the plaintext and starts with the age header
    const head = (await fs.readFile(cipher)).subarray(0, 24).toString()
    assert.match(head, /^age-encryption\.org\/v1/)
    await decryptFile(cipher, back, { mode: 'keypair', identity, recipient })
    assert.equal(await fs.readFile(back, 'utf8'), 'hello age')
    await assert.rejects(() => decryptFile(cipher, path.join(dir, 'bad'), { mode: 'keypair', recipient }))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('age: a passphrase round-trips, a wrong passphrase fails, and the plaintext hash matches', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-age-pass-'))
  try {
    const src = path.join(dir, 'plain.bin')
    const cipher = path.join(dir, 'cipher.bin')
    const back = path.join(dir, 'back.bin')
    const data = Buffer.from('a'.repeat(200_000))
    await fs.writeFile(src, data)
    await encryptFile(src, cipher, { mode: 'passphrase', passphrase: 'correct horse battery staple' })
    await assert.rejects(() =>
      decryptFile(cipher, back, { mode: 'passphrase', passphrase: 'wrong passphrase' })
    )
    await decryptFile(cipher, back, { mode: 'passphrase', passphrase: 'correct horse battery staple' })
    assert.deepEqual(await fs.readFile(back), data)
    assert.equal(
      await hashPlaintext(cipher, { mode: 'passphrase', passphrase: 'correct horse battery staple' }),
      sha(data)
    )
    // a plain file hashes directly
    assert.equal(await hashPlaintext(src), sha(data))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('age: recipient/identity shape checks reject nonsense', () => {
  assert.equal(looksLikeRecipient('age1not-a-real-recipient'), false)
  assert.equal(looksLikeRecipient('AGE-SECRET-KEY-1'), false)
  assert.equal(looksLikeIdentity('age1qqqq'), false)
})
