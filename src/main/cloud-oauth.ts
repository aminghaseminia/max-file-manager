/**
 * OAuth2 + PKCE for the three hosted providers, without a browser window of our own:
 * the system browser opens the consent page and the code comes back to a loopback listener on
 * 127.0.0.1 (the same shape rclone and every desktop client use).
 *
 * The client id belongs to the user's own app: this repository ships none, so nothing here depends
 * on a secret we would have to distribute.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { OAUTH_REDIRECT_PORT } from '../shared/cloud.ts'

export type OAuthProviderId = 'gdrive' | 'dropbox' | 'onedrive'
export type OAuthConfig = { clientId: string; clientSecret?: string }
export type OAuthTokens = { access: string; refresh?: string; expiresAt: number }
export type OAuthLoginResult = { tokens: OAuthTokens; label: string }

type Info = {
  authorize: string
  token: string
  scope: string
  /** Google's installed-app client needs its secret; Dropbox and Microsoft are public clients */
  needsSecret: boolean
  extra: Record<string, string>
  docs: string
}

export const OAUTH_INFO: Record<OAuthProviderId, Info> = {
  gdrive: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    // the full drive scope is deliberate: the folder picker has to see folders that already exist
    scope: 'https://www.googleapis.com/auth/drive openid email',
    needsSecret: true,
    extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    docs: 'https://developers.google.com/workspace/guides/create-credentials'
  },
  dropbox: {
    authorize: 'https://www.dropbox.com/oauth2/authorize',
    token: 'https://api.dropboxapi.com/oauth2/token',
    scope: 'account_info.read files.metadata.read files.content.read files.content.write',
    needsSecret: false,
    extra: { token_access_type: 'offline' },
    docs: 'https://www.dropbox.com/developers/apps'
  },
  onedrive: {
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'offline_access Files.ReadWrite User.Read',
    needsSecret: false,
    extra: {},
    docs: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade'
  }
}

const b64url = (b: Buffer): string =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export function buildAuthUrl(
  provider: OAuthProviderId,
  cfg: OAuthConfig,
  redirectUri: string,
  state: string,
  challenge: string
): string {
  const info = OAUTH_INFO[provider]
  const u = new URL(info.authorize)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('scope', info.scope)
  u.searchParams.set('state', state)
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  for (const [k, v] of Object.entries(info.extra)) u.searchParams.set(k, v)
  return u.toString()
}

const form = (values: Record<string, string | undefined>): string => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(values)) if (v !== undefined) p.set(k, v)
  return p.toString()
}

export function tokenBody(
  provider: OAuthProviderId,
  cfg: OAuthConfig,
  values: Record<string, string | undefined>
): { url: string; body: string } {
  return {
    url: OAUTH_INFO[provider].token,
    body: form({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      ...values
    })
  }
}

type RawTokens = { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string }

const parseTokens = (raw: RawTokens, previous?: OAuthTokens): OAuthTokens => {
  if (!raw.access_token) throw new Error(raw.error_description || 'the provider returned no access token')
  const expiresIn = Number(raw.expires_in) || 3600
  return {
    access: raw.access_token,
    refresh: raw.refresh_token ?? previous?.refresh,
    expiresAt: Date.now() + Math.max(60, expiresIn - 30) * 1000
  }
}

async function postToken(provider: OAuthProviderId, cfg: OAuthConfig, values: Record<string, string | undefined>): Promise<RawTokens> {
  const { url, body } = tokenBody(provider, cfg, values)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`sign-in failed (${res.status}): ${text.slice(0, 300)}`)
  return JSON.parse(text) as RawTokens
}

/** The account row's label, straight from the provider. */
export async function profileLabel(provider: OAuthProviderId, access: string): Promise<string> {
  try {
    if (provider === 'gdrive') {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${access}` }
      })
      const j = (await r.json()) as { email?: string; name?: string }
      return j.email || j.name || 'Google Drive'
    }
    if (provider === 'dropbox') {
      const r = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }
      })
      const j = (await r.json()) as { email?: string; name?: { display_name?: string } }
      return j.email || j.name?.display_name || 'Dropbox'
    }
    const r = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${access}` }
    })
    const j = (await r.json()) as { mail?: string; userPrincipalName?: string }
    return j.mail || j.userPrincipalName || 'OneDrive'
  } catch {
    return provider === 'gdrive' ? 'Google Drive' : provider === 'dropbox' ? 'Dropbox' : 'OneDrive'
  }
}

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Max File Manager</title>
<body style="font:15px system-ui;padding:40px;background:#14161b;color:#dfe3ea">
<h2 style="font-weight:600">اتصال انجام شد</h2>
<p>می‌توانی این تب را ببندی و به مکس برگردی.</p></body>`

/**
 * Open the consent page and wait for the loopback callback. Resolves with tokens; rejects when the
 * user denies, the state does not match, or five minutes pass.
 */
export async function oauthLogin(
  provider: OAuthProviderId,
  cfg: OAuthConfig,
  open: (url: string) => void,
  timeoutMs = 5 * 60_000
): Promise<OAuthLoginResult> {
  if (!cfg.clientId.trim()) throw new Error('a client id is required')
  if (OAUTH_INFO[provider].needsSecret && !cfg.clientSecret?.trim()) {
    throw new Error('this provider needs the client secret too')
  }
  const { verifier, challenge } = pkce()
  const state = b64url(randomBytes(16))

  let resolveCode!: (v: { code: string }) => void
  let rejectCode!: (e: Error) => void
  const callback = new Promise<{ code: string }>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  let redirectUri = ''
  let settled = false
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (u.pathname !== '/callback') {
      res.statusCode = 404
      res.end()
      return
    }
    const err = u.searchParams.get('error')
    const got = u.searchParams.get('code')
    const gotState = u.searchParams.get('state')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (err) {
      res.end(DONE_PAGE)
      finish(new Error(`the provider refused: ${err}`))
      return
    }
    if (!got || gotState !== state) {
      res.statusCode = 400
      res.end('state mismatch')
      return
    }
    res.end(DONE_PAGE)
    finish(null, got)
  })

  const timer = setTimeout(() => finish(new Error('the sign-in timed out; try again')), timeoutMs)
  function finish(err: Error | null, code?: string): void {
    if (settled) return
    settled = true
    clearTimeout(timer)
    try {
      server.close()
    } catch {
      // already closed
    }
    if (err) rejectCode(err)
    else resolveCode({ code: code! })
  }

  const listen = (port: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const onError = (e: Error): void => {
        server.off('listening', onListening)
        reject(e)
      }
      const onListening = (): void => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })

  try {
    // a fixed port lets Dropbox (which matches the redirect exactly) be configured once
    await listen(OAUTH_REDIRECT_PORT)
  } catch {
    await listen(0)
  }
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  redirectUri = `http://127.0.0.1:${port}/callback`
  // the state was created before the listener; the consent page can now be opened
  open(buildAuthUrl(provider, cfg, redirectUri, state, challenge))

  const done = await callback

  const raw = await postToken(provider, cfg, {
    grant_type: 'authorization_code',
    code: done.code,
    code_verifier: verifier,
    redirect_uri: redirectUri
  })
  const tokens = parseTokens(raw)
  const label = await profileLabel(provider, tokens.access)
  return { tokens, label }
}

export async function oauthRefresh(
  provider: OAuthProviderId,
  cfg: OAuthConfig,
  refresh: string,
  previous?: OAuthTokens
): Promise<OAuthTokens> {
  const raw = await postToken(provider, cfg, {
    grant_type: 'refresh_token',
    refresh_token: refresh,
    scope: OAUTH_INFO[provider].scope
  })
  return parseTokens(raw, previous)
}

export const oauthDocs = (provider: OAuthProviderId): string => OAUTH_INFO[provider].docs
