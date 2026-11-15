import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { expandSshPath, parseSshConfig } from './ssh-config.ts'
import { hostPatternMatches, knownHostVerdict, parseKnownHosts } from './ssh-known-hosts.ts'

const CONFIG = `
# global defaults
Host *
  User deploy
  Port 2222

Host prod
  HostName prod.example.com
  IdentityFile ~/.ssh/id_ed25519
  User alice

Host dev staging
  HostName staging.example.com
  Port 2200
  IdentityFile "~/.ssh/keys/dev key"

Host *.internal
  User wildcard

Host ignored
  User bob
  # Include is deliberately unsupported
  Include ~/.ssh/other
`

test('ssh config: defaults, aliases, ports and identity files', () => {
  const hosts = parseSshConfig(CONFIG, { home: '/home/me', localUser: 'me' })
  assert.deepEqual(hosts.map((h) => h.alias), ['dev', 'ignored', 'prod', 'staging'])
  const prod = hosts.find((h) => h.alias === 'prod')!
  assert.equal(prod.host, 'prod.example.com')
  assert.equal(prod.user, 'alice')
  assert.equal(prod.port, 2222, 'the Host * port applies')
  assert.equal(prod.identityFile, '/home/me/.ssh/id_ed25519')

  const dev = hosts.find((h) => h.alias === 'dev')!
  assert.equal(dev.host, 'staging.example.com')
  assert.equal(dev.port, 2200)
  assert.equal(dev.identityFile, '/home/me/.ssh/keys/dev key')
  assert.equal(dev.user, 'deploy')

  const staging = hosts.find((h) => h.alias === 'staging')!
  assert.equal(staging.host, 'staging.example.com')
  assert.equal(staging.user, 'deploy')
})

test('ssh config: a config without Host *, defaults to user@alias:22', () => {
  const hosts = parseSshConfig('Host box\n  HostName 10.0.0.5\n', { home: '/home/me', localUser: 'me' })
  assert.deepEqual(hosts, [{ alias: 'box', host: '10.0.0.5', user: 'me', port: 22, identityFile: '' }])
  assert.deepEqual(parseSshConfig('', {}), [])
})

test('ssh config: ~, %d, %h, %r and %u expand in identity paths', () => {
  assert.equal(expandSshPath('~/.ssh/id', { home: '/h' }), '/h/.ssh/id')
  assert.equal(expandSshPath('%d/%h/%r/%u.key', { home: '/h', host: 'box', user: 'me', localUser: 'local' }), '/h/box/me/local.key')
  assert.equal(expandSshPath('plain', {}), 'plain')
})

test('known_hosts: plain, ported, wildcard and revoked entries', () => {
  const key = 'AAAAKEYBASE64='
  const text = [
    `example.com ssh-ed25519 ${key}`,
    `[ported.example.com]:2222 ssh-ed25519 ${key}`,
    `*.example.net ssh-ed25519 ${key}`,
    `@revoked revoked.example.com ssh-ed25519 ${key}`
  ].join('\n')
  assert.equal(knownHostVerdict(text, 'example.com', 22, key), 'trusted')
  assert.equal(knownHostVerdict(text, 'example.com', 2222, key), 'unknown', 'plain entries are port 22 only')
  assert.equal(knownHostVerdict(text, 'ported.example.com', 2222, key), 'trusted')
  assert.equal(knownHostVerdict(text, 'a.example.net', 22, key), 'trusted')
  assert.equal(knownHostVerdict(text, 'revoked.example.com', 22, key), 'revoked')
  assert.equal(knownHostVerdict(text, 'example.com', 22, 'OTHER'), 'unknown')
  assert.equal(knownHostVerdict('', 'example.com', 22, key), 'unknown')
  assert.equal(parseKnownHosts(text).length, 4)
})

test('known_hosts: hashed host entries and negation', () => {
  const salt = Buffer.from('0123456789abcdef')
  const hash = createHmac('sha1', salt).update('hashed.example.com').digest('base64')
  const key = 'S0VZ'
  const text = `|1|${salt.toString('base64')}|${hash} ssh-ed25519 ${key}`
  assert.equal(knownHostVerdict(text, 'hashed.example.com', 22, key), 'trusted')
  assert.equal(knownHostVerdict(text, 'other.example.com', 22, key), 'unknown')

  assert.equal(hostPatternMatches(['*.example.com', '!bad.example.com'], 'good.example.com', 22), true)
  assert.equal(hostPatternMatches(['*.example.com', '!bad.example.com'], 'bad.example.com', 22), false)
  assert.equal(hostPatternMatches(['example.com'], 'example.com', 2200), false)
  assert.equal(hostPatternMatches(['[example.com]:2200'], 'example.com', 2200), true)
})
