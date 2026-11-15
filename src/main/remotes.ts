import { safeStorage } from 'electron'
import { readStore, writeStore } from './store.ts'
import { parseRemote, type RemoteLocation } from '../shared/remote-path.ts'
import {
  makeProfileId,
  profileUri,
  validateProfileDraft,
  type ProfileDraft,
  type ProfileSecret,
  type RemoteProfile
} from '../shared/remote-profile.ts'
import {
  createRemoteFs,
  RemoteError,
  type RemoteConfig,
  type RemoteResolution
} from './remote-core.ts'
import { s3Test } from './s3.ts'
import { ftpTest } from './remote-ftp.ts'
import { sftpTest, type SftpConfig } from './remote-sftp.ts'
import { parseSshConfig, type SshConfigHost } from './ssh-config.ts'
import os from 'node:os'
import { promises as fs } from 'node:fs'

/**
 * Connection profiles live in the same SQLite app table as every other setting. Only metadata is
 * plain JSON; the password / secret access key / session token are encrypted with the OS keyring
 * (`safeStorage`) and never sent to the renderer.
 *
 * If the OS has no keyring (a bare X session, some Linux setups), the secret is kept in memory for
 * this session only and the profile says so. Silently writing plaintext credentials would be worse
 * than asking for the password again after a restart.
 */
type SecretData = { password?: string; secretKey?: string; sessionToken?: string; keyPassphrase?: string }
type StoredProfile = RemoteProfile & { secret?: string }
type StoreShape = { version: 1; profiles: StoredProfile[] }

const STORE_KEY = 'remotes'
const SECRET_PREFIX = 'v1:'

const sessionSecrets = new Map<string, SecretData>()
let cache: StoredProfile[] | null = null

function safeEncryption(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    // Electron falls back to a hard-coded key when there is no real keyring; that is not
    // encryption in any useful sense, so treat it like «no keyring» and keep the secret in memory.
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false
    return true
  } catch {
    return false
  }
}

function shape(raw: unknown): StoredProfile[] {
  if (!raw || typeof raw !== 'object') return []
  const profiles = (raw as { profiles?: unknown }).profiles
  if (!Array.isArray(profiles)) return []
  const out: StoredProfile[] = []
  const ids = new Set<string>()
  for (const item of profiles) {
    if (!item || typeof item !== 'object') continue
    const src = item as Record<string, unknown>
    const validated = validateProfileDraft(src as ProfileDraft)
    if (!validated.ok) continue
    const profile = validated.profile
    if (ids.has(profile.id)) continue
    ids.add(profile.id)
    const stored: StoredProfile = {
      ...profile,
      // hostKey is not part of validation (it is learned, not typed), so keep it from disk
      hostKey: typeof src.hostKey === 'string' && src.hostKey ? src.hostKey : profile.hostKey,
      hasSecret: false,
      sessionOnly: false,
      secret: typeof src.secret === 'string' && src.secret ? src.secret : undefined
    }
    out.push(stored)
  }
  return out
}

function load(): StoredProfile[] {
  if (cache) return cache
  cache = shape(readStore<unknown>(STORE_KEY))
  return cache
}

function persist(profiles: StoredProfile[]): void {
  const value: StoreShape = { version: 1, profiles }
  writeStore(STORE_KEY, value)
  cache = profiles
}

function decrypt(stored: StoredProfile): SecretData | null {
  if (stored.secret) {
    if (!safeEncryption()) return null
    try {
      const buf = Buffer.from(stored.secret.slice(SECRET_PREFIX.length), 'base64')
      const data = JSON.parse(safeStorage.decryptString(buf)) as SecretData
      return data && typeof data === 'object' ? data : null
    } catch {
      return null
    }
  }
  return sessionSecrets.get(stored.id) ?? null
}

function writeSecret(id: string, data: SecretData): string | undefined {
  const json = JSON.stringify(data)
  if (safeEncryption()) {
    try {
      const enc = safeStorage.encryptString(json)
      sessionSecrets.delete(id)
      return SECRET_PREFIX + enc.toString('base64')
    } catch {
      // fall through to session-only
    }
  }
  sessionSecrets.set(id, data)
  return undefined
}

function isEmptySecret(s: SecretData): boolean {
  return !s.password && !s.secretKey && !s.sessionToken && !s.keyPassphrase
}

function sanitize(stored: StoredProfile): RemoteProfile {
  const { secret: _secret, ...profile } = stored
  return {
    ...profile,
    hasSecret: !!stored.secret || sessionSecrets.has(stored.id),
    sessionOnly: !stored.secret && sessionSecrets.has(stored.id)
  }
}

export function listRemoteProfiles(): RemoteProfile[] {
  return load().map(sanitize)
}

export function remoteProfileById(id: string): RemoteProfile | null {
  const hit = load().find((p) => p.id === id)
  return hit ? sanitize(hit) : null
}

export function saveRemoteProfile(draft: ProfileDraft): { ok: true; profile: RemoteProfile } | { ok: false; error: string } {
  const profiles = load()
  const editing = draft.id ? profiles.find((p) => p.id === draft.id) : undefined
  const validated = validateProfileDraft(
    { ...draft, id: editing?.id ?? draft.id },
    profiles.map((p) => p.id)
  )
  if (!validated.ok) return { ok: false, error: validated.error }
  const profile = validated.profile
  if (editing && editing.protocol !== profile.protocol) {
    // the credential shape differs per protocol; a protocol change starts with clean secrets
    sessionSecrets.delete(profile.id)
  }
  const index = profiles.findIndex((p) => p.id === profile.id)
  const previous = index >= 0 ? profiles[index] : null
  // changing protocol invalidates the old credential shape; do not carry it over
  const sameProtocol = !!previous && previous.protocol === profile.protocol
  const hadSession = sameProtocol && sessionSecrets.has(profile.id)

  let nextProfile: StoredProfile = {
    ...profile,
    hostKey: sameProtocol ? previous?.hostKey ?? profile.hostKey : profile.hostKey,
    secret: sameProtocol ? previous.secret : undefined
  }

  const wanted = currentSecretFields(draft)
  if (wanted.length) {
    const old = (previous && sameProtocol ? decrypt(previous) : null) ?? {}
    const data: SecretData = { ...old }
    if (draft.password !== undefined) data.password = String(draft.password)
    if (draft.secretKey !== undefined) data.secretKey = String(draft.secretKey)
    if (draft.sessionToken !== undefined) data.sessionToken = String(draft.sessionToken)
    if (draft.keyPassphrase !== undefined) data.keyPassphrase = String(draft.keyPassphrase)
    if (profile.protocol === 's3' && !data.secretKey) {
      return { ok: false, error: 'a secret access key is required' }
    }
    if (profile.anonymous) {
      data.password = ''
      data.secretKey = ''
      data.sessionToken = ''
    }
    if (isEmptySecret(data)) {
      sessionSecrets.delete(profile.id)
      nextProfile = { ...nextProfile, secret: undefined }
    } else {
      nextProfile = { ...nextProfile, secret: writeSecret(profile.id, data) }
    }
  } else if (!previous && !hadSession) {
    if (profile.protocol === 's3') return { ok: false, error: 'a secret access key is required' }
    // FTP without a password is allowed (some servers do not ask for one)
    nextProfile = { ...nextProfile, secret: undefined }
  } else if (profile.anonymous && previous) {
    // switching an existing profile to anonymous drops any stored password
    sessionSecrets.delete(profile.id)
    nextProfile = { ...nextProfile, secret: undefined }
  }

  const next = profiles.filter((p) => p.id !== profile.id)
  next.push(nextProfile)
  persist(next)
  return { ok: true, profile: sanitize(nextProfile) }
}

function currentSecretFields(draft: ProfileDraft): string[] {
  const out: string[] = []
  if (draft.password !== undefined) out.push('password')
  if (draft.secretKey !== undefined) out.push('secretKey')
  if (draft.sessionToken !== undefined) out.push('sessionToken')
  if (draft.keyPassphrase !== undefined) out.push('keyPassphrase')
  return out
}

/** Forget a pinned host key so the next connection may trust a replacement (after asking again). */
export function forgetRemoteHostKey(id: string): boolean {
  const profiles = load()
  const index = profiles.findIndex((p) => p.id === id)
  if (index < 0) return false
  const next = [...profiles]
  next[index] = { ...next[index], hostKey: undefined }
  persist(next)
  return true
}

export function removeRemoteProfile(id: string): boolean {
  const profiles = load()
  const next = profiles.filter((p) => p.id !== id)
  if (next.length === profiles.length) return false
  sessionSecrets.delete(id)
  persist(next)
  return true
}

/** Secret for a saved profile, or null when it is missing/could not be decrypted. */
function savedSecret(stored: StoredProfile): SecretData | null {
  return decrypt(stored)
}

function rememberHostKey(id: string, fingerprint: string): void {
  const profiles = load()
  const index = profiles.findIndex((p) => p.id === id)
  if (index < 0) return
  const old = profiles[index]
  if (old.hostKey === fingerprint) return
  const next = [...profiles]
  // pinning the fingerprint turns TOFU off: a later, different key is rejected
  next[index] = { ...old, hostKey: fingerprint, acceptNewHostKey: false }
  persist(next)
}

function configFor(stored: StoredProfile): RemoteConfig {
  if (stored.protocol === 'sftp') {
    const secret = savedSecret(stored) ?? {}
    const cfg: SftpConfig = {
      host: stored.host,
      port: stored.port || 22,
      user: stored.user || '',
      auth: stored.auth ?? 'password',
      password: secret.password,
      keyPath: stored.keyPath,
      passphrase: secret.keyPassphrase,
      agent: process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? 'pageant' : undefined),
      hostKey: stored.hostKey,
      acceptNewHostKey: stored.acceptNewHostKey === true,
      onHostKey: (fingerprint) => rememberHostKey(stored.id, fingerprint)
    }
    return { protocol: 'sftp', ...cfg }
  }
  if (stored.protocol === 's3') {
    const secret = savedSecret(stored) ?? {}
    if (!secret.secretKey) {
      throw new RemoteError(
        'auth',
        `the secret key for «${stored.name}» is not saved; open Remote connections and enter it again`
      )
    }
    return {
      protocol: 's3',
      bucket: stored.bucket ?? '',
      region: stored.region || 'us-east-1',
      endpoint: stored.endpoint || undefined,
      pathStyle: stored.pathStyle === true,
      accessKey: stored.accessKey ?? '',
      secretKey: secret.secretKey,
      sessionToken: secret.sessionToken || undefined,
      verifyTls: stored.verifyTls !== false
    }
  }
  const secret = savedSecret(stored) ?? {}
  return {
    protocol: stored.protocol,
    host: stored.host,
    port: stored.port || (stored.implicitTLS ? 990 : 21),
    user: stored.user || 'anonymous',
    password: secret.password || (stored.anonymous ? 'anonymous@' : ''),
    implicitTLS: stored.implicitTLS === true,
    verifyTls: stored.verifyTls !== false
  }
}

function matchProfile(loc: RemoteLocation): StoredProfile {
  const profiles = load()
  if (loc.scheme === 's3') {
    if (loc.profile) {
      const hit = profiles.find((p) => p.protocol === 's3' && p.id === loc.profile)
      if (hit) return hit
      throw new RemoteError('no_profile', `no S3 connection named «${loc.profile}» is saved`)
    }
    const bucket = loc.host.toLowerCase()
    const matches = profiles.filter((p) => p.protocol === 's3' && (p.bucket ?? '').toLowerCase() === bucket)
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      throw new RemoteError(
        'ambiguous_profile',
        `more than one saved S3 connection uses the bucket «${loc.host}»; open it from Remote connections`
      )
    }
    throw new RemoteError('no_profile', `no saved S3 connection matches «${loc.host}»`)
  }
  const port = loc.port || 21
  const defaultPort = (p: StoredProfile): number =>
    p.port || (p.protocol === 'sftp' ? 22 : p.implicitTLS ? 990 : 21)
  const candidates = profiles.filter(
    (p) =>
      (p.protocol === 'ftp' || p.protocol === 'ftps' || p.protocol === 'sftp') &&
      p.protocol === loc.scheme &&
      p.host.toLowerCase() === loc.host.toLowerCase() &&
      defaultPort(p) === port &&
      (!loc.user ||
        (p.anonymous ? loc.user === 'anonymous' || loc.user === 'ftp' : p.user === loc.user))
  )
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) {
    throw new RemoteError(
      'ambiguous_profile',
      `more than one saved ${loc.scheme.toUpperCase()} connection matches this server; open it from Remote connections`
    )
  }
  throw new RemoteError(
    'no_profile',
    `no saved ${loc.scheme.toUpperCase()} connection matches ${loc.user ? loc.user + '@' : ''}${loc.host}:${port}`
  )
}

export async function resolveRemote(loc: RemoteLocation): Promise<RemoteResolution> {
  const stored = matchProfile(loc)
  return { id: stored.id, name: stored.name, config: configFor(stored) }
}

/** The app-wide remote filesystem; every main-process caller shares it (and therefore its cache). */
export const remoteFs = createRemoteFs(resolveRemote)

/** Test a draft from the dialog before it is saved. */
export async function testRemoteDraft(
  draft: ProfileDraft
): Promise<{ ok: true; detail: string; hostKey?: string } | { ok: false; error: string }> {
  const profiles = load()
  const editing = draft.id ? profiles.find((p) => p.id === draft.id) : undefined
  const validated = validateProfileDraft({ ...draft, id: editing?.id ?? draft.id }, profiles.map((p) => p.id))
  if (!validated.ok) return { ok: false, error: validated.error }
  const profile = validated.profile
  const stored = editing ? decrypt(editing) : null
  try {
    if (profile.protocol === 's3') {
      const secretKey =
        draft.secretKey !== undefined ? String(draft.secretKey) : stored?.secretKey ?? ''
      if (!secretKey) return { ok: false, error: 'enter the secret access key to test the connection' }
      const result = await s3Test({
        bucket: profile.bucket ?? '',
        region: profile.region || 'us-east-1',
        endpoint: profile.endpoint || undefined,
        pathStyle: profile.pathStyle === true,
        accessKey: profile.accessKey ?? '',
        secretKey,
        sessionToken: draft.sessionToken !== undefined ? String(draft.sessionToken) : stored?.sessionToken,
        verifyTls: profile.verifyTls !== false
      })
      return { ok: true, detail: `bucket reachable · ${result.objects + result.prefixes} entries` }
    }
    if (profile.protocol === 'sftp') {
      const passphrase =
        draft.keyPassphrase !== undefined ? String(draft.keyPassphrase) : stored?.keyPassphrase ?? ''
      const password = draft.password !== undefined ? String(draft.password) : stored?.password ?? ''
      const result = await sftpTest({
        host: profile.host,
        port: profile.port || 22,
        user: profile.user || '',
        auth: profile.auth ?? 'password',
        password,
        keyPath: profile.keyPath,
        passphrase,
        agent: process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? 'pageant' : undefined),
        hostKey: profile.hostKey ?? editing?.hostKey,
        acceptNewHostKey: profile.acceptNewHostKey === true,
        home: os.homedir()
      })
      return { ok: true, detail: `SFTP connected · ${result.entries} entries · ${result.hostKey}`, hostKey: result.hostKey }
    }
    const password =
      draft.password !== undefined ? String(draft.password) : stored?.password ?? ''
    const result = await ftpTest({
      host: profile.host,
      port: profile.port || (profile.implicitTLS ? 990 : 21),
      user: profile.user || 'anonymous',
      password: password || (profile.anonymous ? 'anonymous@' : ''),
      secure: profile.protocol === 'ftps' ? (profile.implicitTLS ? 'implicit' : 'explicit') : 'none',
      verifyTls: profile.verifyTls !== false
    })
    return { ok: true, detail: `${profile.protocol.toUpperCase()} connected · ${result.entries} entries in ${result.root}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** List a saved profile's root now (the dialog's «Test» button on an existing row). */
export async function testSavedProfile(
  id: string
): Promise<{ ok: true; detail: string; hostKey?: string } | { ok: false; error: string }> {
  const stored = load().find((p) => p.id === id)
  if (!stored) return { ok: false, error: 'connection not found' }
  try {
    const result = await remoteFs.test(profileUri(stored))
    return { ok: true, detail: result.detail }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Starting URI for a saved connection, used by the sidebar and MCP. */
export function remoteProfileUri(id: string): string | null {
  const stored = load().find((p) => p.id === id)
  return stored ? profileUri(stored) : null
}

/** Add or update from MCP (no secret in the log, same validation as the dialog). */
export function upsertRemoteProfile(draft: ProfileDraft): RemoteProfile {
  const saved = saveRemoteProfile(draft)
  if (!saved.ok) throw new RemoteError('invalid_profile', saved.error)
  return saved.profile
}

export { parseRemote, profileUri, makeProfileId }


/** Concrete hosts from `~/.ssh/config`, for the SFTP dialog's import list. */
export async function readSshConfigHosts(): Promise<SshConfigHost[]> {
  const home = os.homedir()
  const text = await fs.readFile(`${home}/.ssh/config`, 'utf8').catch(() => '')
  if (!text) return []
  return parseSshConfig(text, {
    home,
    localUser: os.userInfo().username,
    defaultUser: os.userInfo().username,
    defaultPort: 22
  })
}
