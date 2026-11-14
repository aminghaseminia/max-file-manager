import test from 'node:test'
import assert from 'node:assert/strict'
import { dbusExecQuote, fileUri, globRegExp, matchesPortalFilter, portalPath, updatePortalsConf } from './portal-core.ts'

test('portalPath decodes NUL terminated bytes and rejects relative paths', () => {
  assert.equal(portalPath([...Buffer.from('/tmp/a.txt'), 0]), '/tmp/a.txt')
  assert.equal(portalPath(new Uint8Array([...Buffer.from('/tmp'), 0, 0])), '/tmp')
  assert.equal(portalPath('relative/file'), null)
  assert.equal(portalPath([]), null)
})

test('portal globs support wildcards and character classes', () => {
  assert.ok(globRegExp('*.[jJ][pP][gG]').test('photo.JPG'))
  assert.ok(globRegExp('file-??.*').test('file-01.txt'))
  assert.ok(!globRegExp('*.txt').test('txt'))
  assert.ok(globRegExp('a+b.txt').test('a+b.txt'))
})

test('portal filters accept glob and MIME rules', () => {
  assert.ok(matchesPortalFilter('photo.png', 'png', { name: 'Images', rules: [[1, 'image/*']] }))
  assert.ok(matchesPortalFilter('notes.md', 'md', { name: 'Text', rules: [[0, '*.md']] }))
  assert.ok(!matchesPortalFilter('notes.txt', 'txt', { name: 'PNG', rules: [[0, '*.png']] }))
})

test(' portals.conf changes are surgical and preserve fallbacks', () => {
  const before = '[preferred]\ndefault=kde;\norg.freedesktop.impl.portal.FileChooser=gtk;kde;\n'
  const enabled = updatePortalsConf(before, true)
  assert.match(enabled, /FileChooser=mfm;gtk;kde;/)
  assert.match(enabled, /default=kde;/)
  assert.equal(updatePortalsConf(enabled, false), before)
  assert.equal(updatePortalsConf(enabled, true), enabled)
})

test('portals.conf is created when no preferred group exists', () => {
  assert.equal(updatePortalsConf('', true), '[preferred]\norg.freedesktop.impl.portal.FileChooser=mfm;\n')
  assert.equal(updatePortalsConf('', false), '')
})

test('D-Bus Exec quoting handles spaces and single quotes', () => {
  assert.equal(dbusExecQuote("/tmp/a b/it's"), `'/tmp/a b/it'\\''s'`)
  assert.equal(fileUri('/tmp/a b.txt'), 'file:///tmp/a%20b.txt')
})
