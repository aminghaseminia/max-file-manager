import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appHandles,
  execFor,
  macAppName,
  mimeForPath,
  parseDesktopEntry,
  parseMacAppPaths,
  parseWindowsOpenWith,
  systemOpenCommand,
  windowsArgv
} from './apps.ts'

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


test('parseWindowsOpenWith accepts the object shape PowerShell emits', () => {
  const json = JSON.stringify({
    defaultId: 'progid:AcroExch.Document.DC',
    apps: [
      {
        id: 'progid:AcroExch.Document.DC',
        name: 'Adobe Acrobat',
        command: '"C:\\Program Files\\Adobe\\Acrobat.exe" "%1"'
      },
      {
        id: 'progid:Applications\\firefox.exe',
        name: 'Firefox',
        command: '"C:\\Program Files\\Mozilla Firefox\\firefox.exe" -osint -url "%1"'
      }
    ]
  })
  const parsed = parseWindowsOpenWith(json)
  assert.equal(parsed.defaultId, 'progid:AcroExch.Document.DC')
  assert.deepEqual(parsed.apps.map((a) => a.name), ['Adobe Acrobat', 'Firefox'])
  assert.match(parsed.apps[1].command ?? '', /firefox\.exe/)
})

test('parseWindowsOpenWith handles a single row, junk and an array', () => {
  assert.deepEqual(parseWindowsOpenWith(''), { defaultId: '', apps: [] })
  assert.deepEqual(parseWindowsOpenWith('not json'), { defaultId: '', apps: [] })
  const one = parseWindowsOpenWith(JSON.stringify({ id: 'appid:MSEdge', name: 'Edge' }))
  assert.deepEqual(one.apps.map((a) => a.id), ['appid:MSEdge'])
  const arrayOnly = parseWindowsOpenWith(JSON.stringify([{ id: 'progid:Foo', name: '' }]))
  assert.deepEqual(arrayOnly.apps, [{ id: 'progid:Foo', name: 'progid:Foo', command: '' }])
})

test('windowsArgv keeps quoted paths and puts the file on the placeholder', () => {
  const argv = windowsArgv('"C:\\Program Files\\App\\app.exe" --open "%1"', 'C:\\Users\\me\\a b.txt')
  assert.deepEqual(argv, ['C:\\Program Files\\App\\app.exe', '--open', 'C:\\Users\\me\\a b.txt'])
  const noPlaceholder = windowsArgv('"C:\\App\\viewer.exe"', 'C:\\x.pdf')
  assert.deepEqual(noPlaceholder, ['C:\\App\\viewer.exe', 'C:\\x.pdf'])
  const upper = windowsArgv('C:\\App\\viewer.exe "%L"', 'C:\\y.pdf')
  assert.deepEqual(upper, ['C:\\App\\viewer.exe', 'C:\\y.pdf'])
  const dropped = windowsArgv('C:\\App\\viewer.exe /dde %v %1', 'C:\\z.pdf')
  assert.deepEqual(dropped, ['C:\\App\\viewer.exe', '/dde', 'C:\\z.pdf'])
})

test('parseMacAppPaths keeps bundles only and removes duplicates', () => {
  const out = [
    '/Applications/Preview.app',
    '/Applications/Preview.app',
    '/System/Applications/TextEdit.app/',
    '/Users/me/Downloads/file.pdf',
    '',
    '  /Applications/Safari.app  '
  ].join('\n')
  assert.deepEqual(parseMacAppPaths(out), [
    '/Applications/Preview.app',
    '/System/Applications/TextEdit.app',
    '/Applications/Safari.app'
  ])
  assert.equal(macAppName('/Applications/Visual Studio Code.app/'), 'Visual Studio Code')
})
