import assert from 'node:assert/strict'
import test from 'node:test'
import { appHandles, execFor, mimeForPath, parseDesktopEntry, systemOpenCommand } from './apps.ts'

const ENTRY = `[Desktop Entry]
Type=Application
Name=Foo Viewer
Exec=/usr/bin/foo --open %F
Icon=foo
MimeType=application/pdf;image/png;
NoDisplay=false
`

test('desktop entries are parsed from the [Desktop Entry] group only', () => {
  const entry = parseDesktopEntry(
    '[Desktop Action new]\nName=New\nExec=/bin/x\n[Desktop Entry]\nType=Application\nName=Real\nExec=/bin/real %f\n'
  )
  assert.equal(entry['Name'], 'Real', 'the last group wins, actions do not leak in')
  assert.equal(entry['Exec'], '/bin/real %f')
})

test('an app is offered only for a MIME type it claims', () => {
  const entry = parseDesktopEntry(ENTRY)
  assert.equal(appHandles(entry, 'application/pdf'), true)
  assert.equal(appHandles(entry, 'text/plain'), false)
  assert.equal(appHandles({ ...entry, NoDisplay: 'true' }, 'application/pdf'), false)
  assert.equal(appHandles({ ...entry, Hidden: 'true' }, 'application/pdf'), false)
  assert.equal(appHandles({ ...entry, Type: 'Link' }, 'application/pdf'), false)
})

test('Exec tokens: the file replaces %f/%F/%u/%U and other codes disappear', () => {
  assert.deepEqual(execFor('/usr/bin/foo --open %F', '/tmp/a.pdf'), [
    '/usr/bin/foo',
    '--open',
    '/tmp/a.pdf'
  ])
  assert.deepEqual(execFor('"/opt/My App/run" %u', '/tmp/a b.pdf'), ['/opt/My App/run', '/tmp/a b.pdf'])
  assert.deepEqual(execFor('foo %i %c %k %f', '/x'), ['foo', '/x'])
  assert.deepEqual(execFor('foo %%', '/x'), ['foo'])
})

test('file extensions map to the MIME type the desktop uses', () => {
  assert.equal(mimeForPath('/a/b/report.pdf'), 'application/pdf')
  assert.equal(mimeForPath('/a/PHOTO.JPG'), 'image/jpeg')
  assert.equal(mimeForPath('/a/note.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(mimeForPath('/a/unknown.weird'), 'application/octet-stream')
})

test('macOS and Windows hand the file to the OS launcher, Linux stays on .desktop', () => {
  assert.deepEqual(systemOpenCommand('darwin', '/a/b.pdf'), ['open', ['/a/b.pdf']])
  assert.deepEqual(systemOpenCommand('win32', '/a/b.pdf'), ['cmd', ['/c', 'start', '', '/a/b.pdf']])
  assert.equal(systemOpenCommand('linux', '/a/b.pdf'), null)
})
