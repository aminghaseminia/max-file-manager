import test from 'node:test'
import assert from 'node:assert/strict'
import { makeProfileId, profileLabel, profileUri, validateProfileDraft } from '../shared/remote-profile.ts'

test('FTP draft gets defaults, a slug id and an absolute starting folder', () => {
  const r = validateProfileDraft({
    protocol: 'ftp',
    name: 'Prod Files',
    host: 'files.example.com',
    user: 'alice',
    password: 'secret',
    root: 'inbox//today/../now'
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.profile.id, 'prod-files')
  assert.equal(r.profile.port, 21)
  assert.equal(r.profile.root, '/inbox/now')
  assert.equal(r.profile.verifyTls, true)
  assert.equal(r.secret.password, 'secret')
  assert.equal(profileUri(r.profile), 'ftp://alice@files.example.com/inbox/now')
})

test('implicit FTPS defaults to port 990 and keeps the flag', () => {
  const r = validateProfileDraft({
    protocol: 'ftps',
    host: 'secure.example.com',
    user: 'bob',
    implicitTLS: true,
    verifyTls: false
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.profile.port, 990)
  assert.equal(r.profile.implicitTLS, true)
  assert.equal(r.profile.verifyTls, false)
  assert.equal(profileUri(r.profile), 'ftps://bob@secure.example.com:990/')
})

test('anonymous FTP has no user field in the URI and an empty password', () => {
  const r = validateProfileDraft({ protocol: 'ftp', host: 'ftp.gnu.org', anonymous: true })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.profile.user, 'anonymous')
  assert.equal(r.secret.password, '')
  assert.equal(profileUri(r.profile), 'ftp://ftp.gnu.org/')
})

test('invalid FTP host, user and port are rejected with a readable reason', () => {
  assert.equal(validateProfileDraft({ protocol: 'ftp', host: 'bad host', user: 'a' }).ok, false)
  assert.equal(validateProfileDraft({ protocol: 'ftp', host: 'example.com', user: '' }).ok, false)
  assert.equal(validateProfileDraft({ protocol: 'ftp', host: 'example.com', user: 'a', port: 70000 }).ok, false)
  assert.equal(validateProfileDraft({ protocol: 'ftp', host: 'example.com', user: 'a', port: 'abc' }).ok, true)
})

test('S3 draft defaults the region, keeps path style and needs an access key', () => {
  const r = validateProfileDraft({
    protocol: 's3',
    name: 'MinIO',
    bucket: 'photos',
    endpoint: 'http://127.0.0.1:9000',
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
    pathStyle: true
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.profile.region, 'us-east-1')
  assert.equal(r.profile.pathStyle, true)
  assert.equal(profileUri(r.profile), 's3://minio@photos/')
  assert.equal(validateProfileDraft({ protocol: 's3', bucket: 'photos', accessKey: '' }).ok, false)
  assert.equal(validateProfileDraft({ protocol: 's3', bucket: 'bad/bucket', accessKey: 'x' }).ok, false)
})

test('profile ids are unique and label falls back to the server', () => {
  assert.equal(makeProfileId('My Server', []), 'my-server')
  assert.equal(makeProfileId('My Server', ['my-server']), 'my-server-2')
  assert.equal(makeProfileId('!!!', []), 'remote')
  const r = validateProfileDraft({ protocol: 's3', bucket: 'bucket', accessKey: 'x' })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(profileLabel(r.profile), 'bucket')
})


test('SFTP draft: password or key auth, default port, and an SSH-style URI', () => {
  const password = validateProfileDraft({
    protocol: 'sftp',
    name: 'Web server',
    host: 'server.example.com',
    user: 'alice',
    root: 'srv/www'
  })
  assert.equal(password.ok, true)
  if (!password.ok) return
  assert.equal(password.profile.port, 22)
  assert.equal(password.profile.auth, 'password')
  assert.equal(password.profile.root, '/srv/www')
  assert.equal(profileUri(password.profile), 'sftp://alice@server.example.com/srv/www')

  const key = validateProfileDraft({
    protocol: 'sftp',
    host: 'server.example.com',
    user: 'alice',
    auth: 'key',
    keyPath: '~/.ssh/id_ed25519',
    keyPassphrase: 'secret'
  })
  assert.equal(key.ok, true)
  if (!key.ok) return
  assert.equal(key.profile.auth, 'key')
  assert.equal(key.profile.keyPath, '~/.ssh/id_ed25519')
  assert.equal(key.secret.keyPassphrase, 'secret')
  assert.equal(profileUri(key.profile), 'sftp://alice@server.example.com/')

  assert.equal(validateProfileDraft({ protocol: 'sftp', host: 'h', user: 'u', auth: 'key' }).ok, false)
  assert.equal(validateProfileDraft({ protocol: 'sftp', host: 'h', user: '' }).ok, false)
  assert.equal(
    validateProfileDraft({ protocol: 'sftp', host: 'h', user: 'u', auth: 'key', keyPath: 'a\nb' }).ok,
    false
  )
})
