/**
 * Secrets for sync (age passphrases and private identities), encrypted with the OS keyring through
 * Electron `safeStorage`. The job only ever stores a `secretId`; the material never goes to the
 * renderer, the session file or the MCP audit log.
 *
 * If the OS has no real keyring (`basic_text` on Linux), the value is kept in memory for this
 * session only and the dialog says so — silently writing a passphrase in plaintext is worse.
 */
import { safeStorage } from 'electron'
import { readStore, writeStore } from './store.ts'

const STORE_KEY = 'syncSecrets'
const SECRET_ID = /^[a-z0-9][a-z0-9-]{7,63}$/
const MAX_SECRETS = 50
const MAX_VALUE = 8192

type Stored = Record<string, string>
const session = new Map<string, string>()
let cache: Stored | null = null

export const validSecretId = (id: unknown): id is string =>
  typeof id === 'string' && SECRET_ID.test(id)

function encryptionAvailable(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    // Electron falls back to a hard-coded key without a keyring; that is not encryption.
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false
    return true
  } catch {
    return false
  }
}

function all(): Stored {
  if (cache) return cache
  const raw = readStore<unknown>(STORE_KEY)
  cache = raw && typeof raw === 'object' ? (raw as Stored) : {}
  return cache
}

function persist(next: Stored): void {
  writeStore(STORE_KEY, next)
  cache = next
}

/** Store or replace a secret. The value is never returned by this module to the renderer. */
export function setSyncSecret(id: string, value: string): { ok: true; sessionOnly: boolean } | { error: string } {
  if (!validSecretId(id)) return { error: 'invalid secret id' }
  const text = String(value)
  if (!text || text.length > MAX_VALUE) return { error: 'the secret is empty or too long' }
  const data = all()
  if (!(id in data) && Object.keys(data).length >= MAX_SECRETS) {
    const oldest = Object.keys(data)[0]
    if (oldest) {
      const copy = { ...data }
      delete copy[oldest]
      persist(copy)
    }
  }
  if (encryptionAvailable()) {
    try {
      session.delete(id)
      persist({ ...all(), [id]: safeStorage.encryptString(text).toString('base64') })
      return { ok: true, sessionOnly: false }
    } catch {
      // fall through to the memory-only path
    }
  }
  session.set(id, text)
  return { ok: true, sessionOnly: true }
}

export function getSyncSecret(id: string): string | null {
  if (!validSecretId(id)) return null
  const stored = all()[id]
  if (stored && encryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      return null
    }
  }
  return session.get(id) ?? null
}

export function hasSyncSecret(id: string): boolean {
  if (!validSecretId(id)) return false
  return Boolean(all()[id]) || session.has(id)
}

export function removeSyncSecret(id: string): boolean {
  if (!validSecretId(id)) return false
  session.delete(id)
  const data = all()
  if (!(id in data)) return false
  const copy = { ...data }
  delete copy[id]
  persist(copy)
  return true
}
