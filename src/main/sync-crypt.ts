/**
 * Per-side encryption for a sync run, using the age format through the pure-JavaScript
 * `age-encryption` package. Files keep their real names; their bytes are age ciphertext.
 *
 * Passphrase mode uses age's scrypt stanza. scrypt is intentionally expensive, so the work factor
 * is capped at 12 (instead of the library default 18) and the UI recommends a keypair for a large
 * tree. Keypair mode is X25519 and fast.
 *
 * Nothing here sees a secret from the renderer: the service resolves a secret id from
 * `sync-secrets.ts` and hands the material to these functions.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Decrypter, Encrypter, generateIdentity, identityToRecipient } from 'age-encryption'

export type ResolvedEncryption =
  | { mode: 'passphrase'; passphrase: string }
  | { mode: 'keypair'; identity?: string; recipient: string }

const SCRYPT_LOG_N = 12

const toWeb = (stream: ReturnType<typeof createReadStream>): ReadableStream<Uint8Array> =>
  Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>

const fromWeb = (stream: ReadableStream<Uint8Array>): NodeJS.ReadableStream =>
  Readable.fromWeb(stream as unknown as import('node:stream/web').ReadableStream<Uint8Array>)

export async function encryptFile(src: string, dst: string, enc: ResolvedEncryption): Promise<void> {
  const e = new Encrypter()
  if (enc.mode === 'passphrase') {
    e.setScryptWorkFactor(SCRYPT_LOG_N)
    e.setPassphrase(enc.passphrase)
  } else {
    if (!enc.recipient) throw new Error('the age recipient (public key) is missing')
    e.addRecipient(enc.recipient)
  }
  const out = await e.encrypt(toWeb(createReadStream(src)))
  await fs.mkdir(path.dirname(dst), { recursive: true })
  await pipeline(fromWeb(out), createWriteStream(dst))
}

export async function decryptFile(src: string, dst: string, enc: ResolvedEncryption): Promise<void> {
  const d = new Decrypter()
  if (enc.mode === 'passphrase') d.addPassphrase(enc.passphrase)
  else {
    if (!enc.identity) throw new Error('the age identity (private key) is missing')
    d.addIdentity(enc.identity)
  }
  const out = await d.decrypt(toWeb(createReadStream(src)))
  await fs.mkdir(path.dirname(dst), { recursive: true })
  await pipeline(fromWeb(out), createWriteStream(dst))
}

async function hashFile(file: string): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer)
  return h.digest('hex')
}

/** Hash the **plaintext** of a possibly encrypted file; this is what two-way comparison uses. */
export async function hashPlaintext(src: string, enc?: ResolvedEncryption): Promise<string> {
  if (!enc) return hashFile(src)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-crypt-hash-'))
  const plain = path.join(dir, 'plain')
  try {
    await decryptFile(src, plain, enc)
    return await hashFile(plain)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** A fresh X25519 pair, already in age's Bech32 encoding. */
export async function generateKeypair(): Promise<{ identity: string; recipient: string }> {
  const identity = await generateIdentity()
  const recipient = await identityToRecipient(identity)
  return { identity, recipient }
}

export async function recipientOf(identity: string): Promise<string> {
  return identityToRecipient(identity.trim())
}

/** The age spec's recipient/identity envelopes; a cheap shape check before a run. */
export const looksLikeRecipient = (s: string): boolean => /^age1[0-9a-z]{20,}$/i.test(s.trim())
export const looksLikeIdentity = (s: string): boolean => /^AGE-SECRET-KEY-1[0-9A-Z]{20,}$/i.test(s.trim())
