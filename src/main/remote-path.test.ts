import test from 'node:test'
import assert from 'node:assert/strict'
import {
  encodeRemotePath,
  formatRemote,
  isRemotePath,
  normalizeRemotePath,
  parseRemote,
  remoteDir,
  remoteJoin,
  remoteName,
  remoteOriginKey,
  remoteParent,
  remotePathOf,
  remoteProtocolLabel,
  remoteRoot,
  remoteRootLabel
} from '../shared/remote-path.ts'

test('remote detection only accepts the three supported schemes', () => {
  assert.equal(isRemotePath('ftp://example.com/'), true)
  assert.equal(isRemotePath('ftps://example.com/'), true)
  assert.equal(isRemotePath('s3://bucket/key'), true)
  assert.equal(isRemotePath('https://example.com/'), false)
  assert.equal(isRemotePath('/home/user'), false)
  assert.equal(isRemotePath(null), false)
  assert.equal(isRemotePath('ftp:/broken'), false)
})

test('ftp URI parses user, port and an encoded path without losing characters', () => {
  const loc = parseRemote('ftp://alice@files.example.com:2121/inbox/hello%20world%20%23%3F.txt')
  assert.deepEqual(loc, {
    scheme: 'ftp',
    profile: '',
    user: 'alice',
    host: 'files.example.com',
    port: 2121,
    path: '/inbox/hello world #?.txt',
    hasPassword: false
  })
  assert.equal(remotePathOf('ftp://alice@files.example.com:2121/inbox/hello%20world%20%23%3F.txt'), '/inbox/hello world #?.txt')
})

test('canonical URI round-trips through parse, including unicode and spaces', () => {
  const uri = formatRemote({
    scheme: 'ftps',
    user: 'کاربر',
    host: 'files.example.com',
    port: 990,
    path: '/گزارش‌ها/سال ۱۴۰۵/note #1.txt'
  })
  assert.match(uri, /^ftps:\/\/%DA%A9/)
  assert.equal(uri.includes(' '), false)
  const loc = parseRemote(uri)
  assert.equal(loc?.path, '/گزارش‌ها/سال ۱۴۰۵/note #1.txt')
  assert.equal(loc?.user, 'کاربر')
  assert.equal(loc?.port, 990)
})

test('a password pasted into a URI is reported, never silently treated as part of auth', () => {
  const loc = parseRemote('ftp://bob:secret@example.com/pub')
  assert.equal(loc?.hasPassword, true)
  assert.equal(loc?.user, 'bob')
  assert.equal(JSON.stringify(loc).includes('secret'), false)
})

test('sftp URIs default to port 22 and round-trip like the other remote schemes', () => {
  const loc = parseRemote('sftp://alice@server.example.com/srv/files')
  assert.equal(loc?.scheme, 'sftp')
  assert.equal(loc?.port, 22)
  assert.equal(loc?.path, '/srv/files')
  assert.equal(
    formatRemote({ scheme: 'sftp', user: 'alice', host: 'server.example.com', path: '/srv/files' }),
    'sftp://alice@server.example.com/srv/files'
  )
  assert.equal(
    formatRemote({ scheme: 'sftp', user: 'alice', host: 'server.example.com', port: 2222, path: '/x' }),
    'sftp://alice@server.example.com:2222/x'
  )
  assert.equal(remoteProtocolLabel('sftp://server/'), 'SFTP')
  assert.equal(remoteName('sftp://alice@server/a/b.txt'), 'b.txt')
  assert.equal(remoteParent('sftp://alice@server/a/b.txt'), 'sftp://alice@server/a')
})

test('s3 URIs encode an optional profile in the userinfo and keep the key opaque', () => {
  const loc = parseRemote('s3://minio@photos/2024/raw/photo 1.jpg')
  assert.deepEqual(loc, {
    scheme: 's3',
    profile: 'minio',
    user: '',
    host: 'photos',
    port: 0,
    path: '2024/raw/photo 1.jpg',
    hasPassword: false
  })
  assert.equal(formatRemote({ scheme: 's3', profile: 'minio', host: 'photos', path: '2024/raw/photo 1.jpg' }), 's3://minio@photos/2024/raw/photo%201.jpg')
  // keys are not POSIX folders: `..` stays a literal key segment
  assert.equal(parseRemote('s3://bucket/a/../b')?.path, 'a/../b')
})

test('remoteParent/remoteDir/remoteRoot and remoteName follow the scheme root', () => {
  const ftp = 'ftp://alice@example.com:21/one/two/three.txt'
  assert.equal(remoteParent(ftp), 'ftp://alice@example.com/one/two')
  assert.equal(remoteName(ftp), 'three.txt')
  assert.equal(remoteRoot(ftp), 'ftp://alice@example.com/')
  assert.equal(remoteParent('ftp://alice@example.com/'), null)
  assert.equal(remoteDir('ftp://alice@example.com/'), 'ftp://alice@example.com/')

  const s3 = 's3://acct@bucket/a/b.txt'
  assert.equal(remoteParent(s3), 's3://acct@bucket/a')
  assert.equal(remoteParent('s3://acct@bucket/a'), 's3://acct@bucket/')
  assert.equal(remoteName('s3://acct@bucket/'), 'bucket')
  assert.equal(remoteDir('s3://acct@bucket/a'), 's3://acct@bucket/')
  assert.equal(remoteRoot('s3://acct@bucket/a/b'), 's3://acct@bucket/')
})

test('remoteJoin appends one safe segment and refuses names that could escape the folder', () => {
  assert.equal(remoteJoin('ftp://example.com/a', 'b c.txt'), 'ftp://example.com/a/b%20c.txt')
  assert.equal(remoteJoin('ftp://example.com/', 'b'), 'ftp://example.com/b')
  assert.equal(remoteJoin('s3://acct@bucket/a', 'b c.txt'), 's3://acct@bucket/a/b%20c.txt')
  assert.equal(remoteJoin('s3://acct@bucket/', 'b'), 's3://acct@bucket/b')
  for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'a\nb', 'a\0b']) {
    assert.throws(() => remoteJoin('ftp://example.com/a', bad), /invalid remote name/)
  }
})

test('remote origin key ignores the path and keeps the identity used for profiles', () => {
  assert.equal(remoteOriginKey('ftp://alice@example.com:2121/x'), 'ftp|example.com|2121|alice')
  assert.equal(remoteOriginKey('ftps://example.com/'), 'ftps|example.com|21|')
  assert.equal(remoteOriginKey('s3://acct@bucket/a'), 's3|bucket|acct')
  assert.equal(remoteOriginKey('not remote'), '')
})

test('labels are readable and never contain the password', () => {
  assert.equal(remoteRootLabel('ftp://alice@example.com/pub'), 'alice@example.com')
  assert.equal(remoteRootLabel('s3://acct@bucket/a'), 'acct@bucket')
  assert.equal(remoteRootLabel('s3://bucket/a'), 'bucket')
  assert.equal(remoteProtocolLabel('ftps://example.com/'), 'FTPS')
  assert.equal(remoteProtocolLabel('ftp://example.com/'), 'FTP')
  assert.equal(remoteProtocolLabel('s3://bucket/'), 'S3')
})

test('path encoding keeps slashes and encodes each segment', () => {
  assert.equal(encodeRemotePath('/a b/c#d'), '/a%20b/c%23d')
  assert.equal(normalizeRemotePath('/a//b/./c/../d/'), '/a/b/d')
  assert.equal(normalizeRemotePath('relative/path/'), 'relative/path')
})
