import { formatRemote, normalizeRemotePath } from './remote-path.ts'

/**
 * A connection profile as the renderer sees it: everything *except* secrets. Passwords, secret
 * keys and session tokens are encrypted in main by `safeStorage` and never cross the bridge.
 *
 * Keeping the shape in `shared` means the dialog and the main-process validation cannot drift.
 */
export type RemoteProtocol = 'ftp' | 'ftps' | 'sftp' | 's3'

export type RemoteProfile = {
  id: string
  protocol: RemoteProtocol
  name: string
  /** FTP host. Empty for S3. */
  host: string
  /** FTP port; default 21, or 990 for implicit TLS. */
  port?: number
  /** FTP login name; `anonymous` when the user picked anonymous access. */
  user?: string
  /** FTP folder opened on connect. */
  root?: string
  /** S3 bucket. Empty for FTP. */
  bucket?: string
  /** S3 region; `us-east-1` when omitted. */
  region?: string
  /** S3-compatible endpoint such as `https://minio.example:9000`; empty means AWS. */
  endpoint?: string
  /** S3 path-style addressing (MinIO, Ceph); false/undefined for AWS virtual-host buckets. */
  pathStyle?: boolean
  /** FTPS implicit TLS (usually port 990). */
  implicitTLS?: boolean
  /** SFTP authentication; `key` uses `keyPath`, `agent` uses SSH_AUTH_SOCK/pageant. */
  auth?: 'password' | 'key' | 'agent'
  /** local private key file; the key itself is never copied into the profile */
  keyPath?: string
  /** trusted host key fingerprint (OpenSSH `SHA256:…`) learned with trust-on-first-use */
  hostKey?: string
  /** accept and remember an unknown host key on the next connection */
  acceptNewHostKey?: boolean
  /** false accepts a self-signed certificate. */
  verifyTls?: boolean
  /** S3 access key id; not secret. */
  accessKey?: string
  /** no login: FTP anonymous access */
  anonymous?: boolean
  /** a secret is stored for this profile */
  hasSecret?: boolean
  /** OS keyring was unavailable: the secret only lives until the app quits */
  sessionOnly?: boolean
}

export type ProfileSecret = {
  /** undefined = keep the stored secret, '' = clear it, anything else = replace it */
  password?: string
  secretKey?: string
  sessionToken?: string
  keyPassphrase?: string
}

export type ProfileDraft = {
  id?: string
  protocol?: string
  name?: string
  host?: string
  port?: number | string
  user?: string
  root?: string
  bucket?: string
  region?: string
  endpoint?: string
  pathStyle?: boolean
  implicitTLS?: boolean
  verifyTls?: boolean
  auth?: string
  keyPath?: string
  hostKey?: string
  acceptNewHostKey?: boolean
  keyPassphrase?: string
  accessKey?: string
  anonymous?: boolean
  password?: string
  secretKey?: string
  sessionToken?: string
}

export type ValidatedProfile = { ok: true; profile: RemoteProfile; secret: ProfileSecret } | { ok: false; error: string }

const HOST_RE = /^[A-Za-z0-9._:[\]-]+$/
const BUCKET_RE = /^[A-Za-z0-9._-]{1,255}$/
const REGION_RE = /^[A-Za-z0-9-]{1,64}$/
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const portOf = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)

export function makeProfileId(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing)
  let base =
    text(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'remote'
  if (!ID_RE.test(base)) base = 'remote'
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

/** Normalise and validate a draft. Secrets are passed through untouched (they are not metadata). */
export function validateProfileDraft(draft: ProfileDraft, existingIds: Iterable<string> = []): ValidatedProfile {
  const protocol = text(draft.protocol) as RemoteProtocol
  if (protocol !== 'ftp' && protocol !== 'ftps' && protocol !== 'sftp' && protocol !== 's3') {
    return { ok: false, error: 'protocol must be ftp, ftps or s3' }
  }
  const id = text(draft.id)
  if (id && !ID_RE.test(id)) return { ok: false, error: 'invalid profile id' }
  const name = text(draft.name).slice(0, 80)
  const verifyTls = draft.verifyTls !== false
  const secret: ProfileSecret = {}
  if (draft.password !== undefined) secret.password = String(draft.password)
  if (draft.secretKey !== undefined) secret.secretKey = String(draft.secretKey)
  if (draft.sessionToken !== undefined) secret.sessionToken = String(draft.sessionToken)
  if (draft.keyPassphrase !== undefined) secret.keyPassphrase = String(draft.keyPassphrase)

  if (protocol === 'sftp') {
    const host = text(draft.host)
    if (!host || host.length > 255 || !HOST_RE.test(host)) return { ok: false, error: 'a valid SFTP host is required' }
    const port = portOf(draft.port) || 22
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'the SFTP port must be 1–65535' }
    const user = text(draft.user)
    if (!user) return { ok: false, error: 'an SFTP user name is required' }
    const keyPath = text(draft.keyPath)
    if (keyPath && (/[\0\r\n]/.test(keyPath) || keyPath.length > 1024)) {
      return { ok: false, error: 'invalid private key path' }
    }
    const auth: 'password' | 'key' | 'agent' =
      draft.auth === 'key' || draft.auth === 'agent' || draft.auth === 'password'
        ? draft.auth
        : keyPath
          ? 'key'
          : 'password'
    if (auth === 'key' && !keyPath) return { ok: false, error: 'a private key file is required for key authentication' }
    const rootRaw = text(draft.root) || '/'
    const root = normalizeRemotePath(rootRaw.startsWith('/') ? rootRaw : '/' + rootRaw) || '/'
    const profile: RemoteProfile = {
      id: id || makeProfileId(name || host, existingIds),
      protocol: 'sftp',
      name: name || host,
      host,
      port,
      user,
      root,
      auth,
      keyPath,
      hostKey: text(draft.hostKey) || undefined,
      acceptNewHostKey: draft.acceptNewHostKey === true,
      verifyTls: false,
      anonymous: false,
      hasSecret: false
    }
    return { ok: true, profile, secret }
  }

  if (protocol === 's3') {
    const bucket = text(draft.bucket)
    if (!BUCKET_RE.test(bucket)) return { ok: false, error: 'a valid S3 bucket name is required' }
    const region = text(draft.region) || 'us-east-1'
    if (!REGION_RE.test(region)) return { ok: false, error: 'invalid S3 region' }
    const endpoint = text(draft.endpoint)
    if (endpoint && !/^https?:\/\/[^\s]+$/i.test(endpoint) && !/^[A-Za-z0-9._:-]+$/.test(endpoint)) {
      return { ok: false, error: 'the endpoint must be an http(s) URL or a host name' }
    }
    const accessKey = text(draft.accessKey)
    if (!accessKey) return { ok: false, error: 'an S3 access key is required' }
    // MinIO/Ceph are path-style; AWS is virtual-host. A custom endpoint therefore defaults to path style.
    const pathStyle = bool(draft.pathStyle) ?? !!endpoint
    const profile: RemoteProfile = {
      id: id || makeProfileId(name || bucket, existingIds),
      protocol: 's3',
      name: name || bucket,
      host: '',
      bucket,
      region,
      endpoint,
      pathStyle,
      verifyTls,
      accessKey,
      anonymous: false,
      hasSecret: false
    }
    return { ok: true, profile, secret }
  }

  const host = text(draft.host)
  if (!host || host.length > 255 || !HOST_RE.test(host)) return { ok: false, error: 'a valid FTP host is required' }
  const implicitTLS = protocol === 'ftps' && draft.implicitTLS === true
  const defaultPort = implicitTLS ? 990 : 21
  const port = portOf(draft.port) || defaultPort
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'the FTP port must be 1–65535' }
  const anonymous = draft.anonymous === true
  const user = anonymous ? 'anonymous' : text(draft.user)
  if (!anonymous && !user) return { ok: false, error: 'an FTP user name is required (or choose anonymous)' }
  const rootRaw = text(draft.root) || '/'
  const root = normalizeRemotePath(rootRaw.startsWith('/') ? rootRaw : '/' + rootRaw) || '/'
  const profile: RemoteProfile = {
    id: id || makeProfileId(name || host, existingIds),
    protocol,
    name: name || host,
    host,
    port,
    user,
    root,
    implicitTLS,
    verifyTls,
    anonymous,
    hasSecret: false
  }
  if (anonymous) {
    secret.password = ''
    secret.secretKey = ''
    secret.sessionToken = ''
  }
  return { ok: true, profile, secret }
}

/** The root URI a profile opens; S3 carries the profile id so accounts cannot be confused. */
export function profileUri(p: RemoteProfile): string {
  if (p.protocol === 's3') {
    return formatRemote({ scheme: 's3', profile: p.id, host: p.bucket ?? '', path: '' })
  }
  return formatRemote({
    scheme: p.protocol,
    user: p.anonymous ? '' : p.user ?? '',
    host: p.host,
    port: p.port || (p.protocol === 'sftp' ? 22 : p.implicitTLS ? 990 : 21),
    path: p.root || '/'
  })
}

/** Human label for the sidebar. */
export function profileLabel(p: RemoteProfile): string {
  return p.name || p.bucket || p.host || p.id
}
