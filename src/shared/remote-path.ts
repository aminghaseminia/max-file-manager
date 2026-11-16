/**
 * Remote locations are ordinary strings with a scheme: `ftp://…`, `ftps://…`, `s3://…`.
 * Both the main process and the renderer speak this format, so a tab, a bookmark or an MCP
 * argument can point at a server exactly like it points at a folder; only the code behind the
 * scheme differs.
 *
 * The URI never carries a password. Credentials live in the encrypted profile store (`remotes.ts`)
 * and are looked up by scheme/host/port/user (FTP) or by the optional profile name in the userinfo
 * part (S3: `s3://profile@bucket/key`). Keeping secrets out of paths is what makes it safe to put a
 * remote tab in the session file or to show its path in the window title.
 */
export const REMOTE_SCHEMES = ['ftp', 'ftps', 'sftp', 's3'] as const
export type RemoteScheme = (typeof REMOTE_SCHEMES)[number]

export type RemoteLocation = {
  scheme: RemoteScheme
  /** S3: profile name written before `@`; FTP: always ''. */
  profile: string
  /** FTP login name, decoded. Empty means anonymous/unspecified. */
  user: string
  /** FTP server or S3 bucket, lowercase (URL host normalisation). */
  host: string
  /** FTP/SFTP port; 0 for S3. */
  port: number
  /** FTP/SFTP: absolute decoded path. S3: decoded key, no leading slash. */
  path: string
  /** a password was pasted into the URI; it is never used, the dialog must ask for one */
  hasPassword: boolean
}

const SCHEME_RE = /^(ftps?|sftp|s3):\/\//i

export function isRemotePath(p: unknown): boolean {
  return typeof p === 'string' && SCHEME_RE.test(p.trim())
}

export function remoteSchemeOf(p: string): RemoteScheme | null {
  const m = SCHEME_RE.exec(String(p ?? '').trim())
  return m ? (m[1].toLowerCase() as RemoteScheme) : null
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Encode one path segment. `encodeURIComponent` leaves `!'()*` alone, which S3 accepts but a
 *  user typing a path does not expect; the strict set keeps both servers and browsers happy. */
export function encodeRemoteSegment(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

/** A whole decoded path → encoded, one segment at a time (slashes stay slashes). */
export function encodeRemotePath(p: string): string {
  return p
    .split('/')
    .map((s) => (s ? encodeRemoteSegment(s) : ''))
    .join('/')
}

/** Lexical POSIX cleanup: collapse empty segments, resolve `.`/`..`, keep a leading slash. */
export function normalizeRemotePath(p: string): string {
  const raw = String(p ?? '').replace(/\\/g, '/')
  const absolute = raw.startsWith('/')
  const out: string[] = []
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (out.length) out.pop()
      continue
    }
    out.push(seg)
  }
  const joined = out.join('/')
  return absolute ? '/' + joined : joined
}

/** Reject control characters before they can reach a protocol command (FTP line injection). */
export function isSafeRemoteName(name: string): boolean {
  return !!name && !/[\0\r\n/\\]/.test(name) && name !== '.' && name !== '..'
}

/**
 * S3 keys are opaque: `..` or a double slash inside a key is a real name, so it must never be
 * lexically cleaned the way an FTP path is. Only the separators around the key are normalised.
 */
export function normalizeS3Key(p: string): string {
  return String(p ?? '').replace(/^\/+/, '').replace(/\/+$/, '')
}

export function parseRemote(input: string): RemoteLocation | null {
  const text = String(input ?? '').trim()
  const scheme = remoteSchemeOf(text)
  if (!scheme) return null
  if (scheme === 's3') return parseS3(text)
  let u: URL
  try {
    u = new URL(text)
  } catch {
    return null
  }
  if (!u.hostname) return null
  const user = safeDecode(u.username)
  const port = Number(u.port) || (scheme === 'sftp' ? 22 : 21)
  const raw = safeDecode(u.pathname || '/')
  return {
    scheme,
    profile: '',
    user,
    host: u.hostname,
    port,
    path: normalizeRemotePath(raw.startsWith('/') ? raw : '/' + raw),
    hasPassword: !!u.password
  }
}

/**
 * S3 is parsed by hand instead of `new URL`: the platform URL parser resolves `.`/`..` segments
 * even in a non-special scheme, and turning a real key into a different one is unacceptable.
 */
function parseS3(text: string): RemoteLocation | null {
  const rest = text.replace(/^s3:\/\//i, '')
  const slash = rest.indexOf('/')
  const authority = (slash < 0 ? rest : rest.slice(0, slash)).replace(/\?.*$/, '').replace(/#.*$/, '')
  const keyPart = slash < 0 ? '' : rest.slice(slash + 1)
  const at = authority.lastIndexOf('@')
  const profile = at > 0 ? safeDecode(authority.slice(0, at)) : ''
  const host = (at > 0 ? authority.slice(at + 1) : authority).replace(/:\d+$/, '')
  if (!host || /[\s\0\r\n]/.test(host)) return null
  const rawKey = safeDecode(keyPart.replace(/[?#].*$/, ''))
  return {
    scheme: 's3',
    profile,
    user: '',
    host,
    port: 0,
    path: normalizeS3Key(rawKey),
    hasPassword: false
  }
}

export type RemoteParts = {
  scheme: RemoteScheme
  profile?: string
  user?: string
  host: string
  port?: number
  path?: string
}

/** Canonical URI. This is the only place that turns parts back into a path string. */
export function formatRemote(parts: RemoteParts): string {
  const scheme = parts.scheme
  const host = String(parts.host ?? '').trim()
  if (!host) throw new Error('remote host is empty')
  if (scheme === 's3') {
    const profile = String(parts.profile ?? '').trim()
    const key = normalizeS3Key(String(parts.path ?? ''))
    const prefix = profile ? `${encodeRemoteSegment(profile)}@` : ''
    return `s3://${prefix}${host}/${encodeRemotePath(key)}`
  }
  const user = String(parts.user ?? '').trim()
  const port = Number(parts.port) || (scheme === 'sftp' ? 22 : 21)
  const defaultPort = scheme === 'sftp' ? 22 : 21
  const authority =
    (user ? `${encodeRemoteSegment(user)}@` : '') + host + (port !== defaultPort ? `:${port}` : '')
  const p = normalizeRemotePath(String(parts.path ?? '/'))
  const path = p.startsWith('/') ? p : '/' + p
  return `${scheme}://${authority}${encodeRemotePath(path)}`
}

/** Rebuild one location with another path (used by parent/child helpers). */
function withPath(loc: RemoteLocation, path: string): string {
  return formatRemote({
    scheme: loc.scheme,
    profile: loc.profile,
    user: loc.user,
    host: loc.host,
    port: loc.port,
    path
  })
}

/** The folder a remote entry sits in; null at a server/bucket root. */
export function remoteParent(uri: string): string | null {
  const loc = parseRemote(uri)
  if (!loc) return null
  if (loc.scheme === 's3') {
    if (!loc.path) return null
    const i = loc.path.lastIndexOf('/')
    return withPath(loc, i < 0 ? '' : loc.path.slice(0, i))
  }
  if (loc.path === '/') return null
  const i = loc.path.lastIndexOf('/')
  return withPath(loc, i <= 0 ? '/' : loc.path.slice(0, i))
}

/** Parent folder, or the location itself at the root. The renderer's `dirOf` uses this. */
export function remoteDir(uri: string): string {
  return remoteParent(uri) ?? remoteRoot(uri)
}

/** Root of the connection: FTP `/`, S3 bucket root. */
export function remoteRoot(uri: string): string {
  const loc = parseRemote(uri)
  if (!loc) return uri
  return withPath(loc, loc.scheme === 's3' ? '' : '/')
}

/** The last path segment, or the host/bucket for a root. */
export function remoteName(uri: string): string {
  const loc = parseRemote(uri)
  if (!loc) return String(uri ?? '')
  if (loc.scheme === 's3') {
    if (!loc.path) return loc.host
    return loc.path.split('/').filter(Boolean).pop() ?? loc.host
  }
  if (loc.path === '/') return loc.user ? `${loc.user}@${loc.host}` : loc.host
  return loc.path.split('/').filter(Boolean).pop() ?? loc.path
}

/** Append a child name to a remote folder. */
export function remoteJoin(dir: string, name: string): string {
  if (!isSafeRemoteName(String(name ?? ''))) throw new Error('invalid remote name')
  const loc = parseRemote(dir)
  if (!loc) throw new Error('invalid remote folder')
  if (loc.scheme === 's3') {
    const key = loc.path ? `${loc.path}/${name}` : name
    return withPath(loc, key)
  }
  const base = loc.path === '/' ? '' : loc.path.replace(/\/+$/, '')
  return withPath(loc, `${base}/${name}`)
}

/**
 * Append a relative path (which may contain slashes) to a remote folder. `remoteJoin` refuses a
 * slash on purpose (it protects FTP commands); the sync engine speaks relative paths, so it needs
 * the same safety per segment without refusing the whole path.
 */
export function remoteJoinRel(dir: string, rel: string): string {
  const parts = String(rel ?? '')
    .split('/')
    .filter((p) => p && p !== '.')
  if (parts.some((p) => p === '..' || /[\0\r\n\\]/.test(p))) throw new Error('invalid remote path')
  const loc = parseRemote(dir)
  if (!loc) throw new Error('invalid remote folder')
  const suffix = parts.join('/')
  if (loc.scheme === 's3') {
    const key = loc.path ? (suffix ? `${loc.path}/${suffix}` : loc.path) : suffix
    return withPath(loc, key)
  }
  const base = loc.path === '/' ? '' : loc.path.replace(/\/+$/, '')
  return withPath(loc, suffix ? `${base}/${suffix}` : base || '/')
}

/** The server/bucket part, which is what a profile lookup is keyed on. */
export function remoteOriginKey(uri: string): string {
  const loc = parseRemote(uri)
  if (!loc) return ''
  if (loc.scheme === 's3') return `s3|${loc.host}|${loc.profile}`
  return `${loc.scheme}|${loc.host}|${loc.port}|${loc.user}`
}

/** Decoded path (FTP absolute path, S3 key). */
export function remotePathOf(uri: string): string {
  const loc = parseRemote(uri)
  return loc ? loc.path : ''
}

/** Root label shown in breadcrumbs: `user@host`, `host`, or `profile@bucket`. */
export function remoteRootLabel(uri: string): string {
  const loc = parseRemote(uri)
  if (!loc) return String(uri ?? '')
  if (loc.scheme === 's3') return loc.profile ? `${loc.profile}@${loc.host}` : loc.host
  return loc.user ? `${loc.user}@${loc.host}` : loc.host
}

/** Human readable protocol badge for the status bar. */
export function remoteProtocolLabel(uri: string): string {
  const scheme = remoteSchemeOf(uri)
  return scheme === 'ftps'
    ? 'FTPS'
    : scheme === 'ftp'
      ? 'FTP'
      : scheme === 'sftp'
        ? 'SFTP'
        : scheme === 's3'
          ? 'S3'
          : ''
}
