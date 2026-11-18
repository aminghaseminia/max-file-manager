import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildAuthUrl, OAUTH_INFO, oauthDocs, oauthLogin, pkce, tokenBody } from './cloud-oauth.ts'
import { driveNameQuery } from './cloud-drive.ts'

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

test('PKCE uses the S256 challenge of the verifier', () => {
  const { verifier, challenge } = pkce()
  assert.match(verifier, /^[A-Za-z0-9_-]{43,}$/)
  assert.equal(challenge, b64url(createHash('sha256').update(verifier).digest()))
})

test('the consent URL carries every parameter the providers require', () => {
  const g = new URL(buildAuthUrl('gdrive', { clientId: 'cid' }, 'http://127.0.0.1:9/callback', 'st', 'ch'))
  assert.equal(g.origin + g.pathname, OAUTH_INFO.gdrive.authorize)
  assert.equal(g.searchParams.get('response_type'), 'code')
  assert.equal(g.searchParams.get('client_id'), 'cid')
  assert.equal(g.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(g.searchParams.get('state'), 'st')
  assert.equal(g.searchParams.get('access_type'), 'offline')
  assert.match(g.searchParams.get('scope') ?? '', /auth\/drive/)

  const d = new URL(buildAuthUrl('dropbox', { clientId: 'cid' }, 'http://127.0.0.1:9/callback', 'st', 'ch'))
  assert.equal(d.origin + d.pathname, OAUTH_INFO.dropbox.authorize)
  assert.equal(d.searchParams.get('token_access_type'), 'offline')
  assert.match(d.searchParams.get('scope') ?? '', /files\.content\.write/)

  const m = new URL(buildAuthUrl('onedrive', { clientId: 'cid' }, 'http://127.0.0.1:9/callback', 'st', 'ch'))
  assert.equal(m.origin + m.pathname, OAUTH_INFO.onedrive.authorize)
  assert.match(m.searchParams.get('scope') ?? '', /Files\.ReadWrite/)
})

test('the token request keeps the secret only when there is one', () => {
  const without = tokenBody('dropbox', { clientId: 'cid' }, { grant_type: 'refresh_token' })
  const params = new URLSearchParams(without.body)
  assert.equal(params.get('client_secret'), null)
  assert.equal(params.get('client_id'), 'cid')
  const withSecret = tokenBody('gdrive', { clientId: 'cid', clientSecret: 'shh' }, { grant_type: 'refresh_token' })
  assert.equal(new URLSearchParams(withSecret.body).get('client_secret'), 'shh')
  assert.equal(withSecret.url, OAUTH_INFO.gdrive.token)
})

test('Drive name queries escape a quote in the name', () => {
  assert.equal(
    driveNameQuery('root', "O'Brien"),
    "name = 'O\\'Brien' and 'root' in parents and trashed = false"
  )
})

test('the docs links are https and provider-specific', () => {
  for (const p of ['gdrive', 'dropbox', 'onedrive'] as const) {
    assert.match(oauthDocs(p), /^https:\/\//)
  }
  assert.notEqual(oauthDocs('gdrive'), oauthDocs('dropbox'))
})

test('a login that is never approved times out and closes its loopback server', async () => {
  let opened = ''
  await assert.rejects(
    oauthLogin('dropbox', { clientId: 'cid' }, (url) => { opened = url }, 150),
    /timed out/
  )
  assert.match(opened, /^https:\/\/www\.dropbox\.com\/oauth2\/authorize\?/)
  assert.match(opened, /redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fcallback/)
})
