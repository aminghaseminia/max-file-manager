import assert from 'node:assert/strict'
import test from 'node:test'
import {
  autoTerminal,
  linuxTerminals,
  listTerminals,
  macTerminals,
  psEncoded,
  psLiteral,
  shQuote,
  windowsTerminalArgs
} from './terminals.ts'

test('windowsTerminalArgs: PowerShell gets an encoded script, not a re-parsed command line', () => {
  const dir = 'C:\\Users\\a b\\Docs & %TEMP%\\بنر'
  const { bin, args } = windowsTerminalArgs('powershell', dir)
  assert.equal(bin, 'cmd.exe')
  // `cmd /c start "" program …`: the empty title keeps start from eating the program name
  assert.deepEqual(args.slice(0, 4), ['/c', 'start', '', 'powershell.exe'])
  assert.equal(args[4], '-NoExit')
  assert.equal(args[5], '-EncodedCommand')

  // nothing in the payload can be re-interpreted by cmd.exe: base64 is letters, digits, + / =
  const payload = args[6]
  assert.match(payload, /^[A-Za-z0-9+/]+={0,2}$/)

  const script = Buffer.from(payload, 'base64').toString('utf16le')
  assert.equal(script, "Set-Location -LiteralPath 'C:\\Users\\a b\\Docs & %TEMP%\\بنر'")
})

test('psLiteral: a single quote inside the path is doubled, nothing else changes', () => {
  assert.equal(psLiteral("C:\\it's\\here"), "'C:\\it''s\\here'")
  assert.equal(psLiteral('/home/o\u2019brien'), "'/home/o\u2019brien'")
})

test('psEncoded: UTF-16LE base64, as -EncodedCommand expects', () => {
  assert.equal(psEncoded('a'), Buffer.from('6100', 'hex').toString('base64'))
  assert.equal(Buffer.from(psEncoded('سلام'), 'base64').toString('utf16le'), 'سلام')
})

test('shQuote: closes, escapes and reopens around a single quote', () => {
  assert.equal(shQuote('/home/me'), "'/home/me'")
  assert.equal(shQuote("/tmp/it's"), "'/tmp/it'\\''s'")
})

test('windowsTerminalArgs: cmd gets the folder through start /D, never inside its command line', () => {
  const { bin, args } = windowsTerminalArgs('cmd', 'D:\\My Files & more')
  assert.equal(bin, 'cmd.exe')
  // the path is its own argument: `start` sets the child's working directory before it starts,
  // so nothing has to survive cmd's quote rules (this used to break at the first space)
  assert.deepEqual(args, ['/c', 'start', '', '/D', 'D:\\My Files & more', 'cmd.exe', '/K'])
  assert.ok(!args.some((a) => a.includes('cd ')))
})

test('lists follow what is installed: Windows shells, macOS Terminal (+iTerm), Linux emulators', () => {
  assert.deepEqual(
    listTerminals('win32').map((t) => t.id),
    ['powershell', 'cmd']
  )

  assert.deepEqual(
    macTerminals(() => false).map((t) => t.id),
    ['terminal']
  )
  assert.deepEqual(
    macTerminals((p) => p === '/Applications/iTerm.app').map((t) => t.id),
    ['terminal', 'iterm']
  )

  const installed = new Set(['konsole', 'kitty'])
  assert.deepEqual(
    linuxTerminals((bin) => installed.has(bin)).map((t) => t.id),
    ['konsole', 'kitty']
  )
  assert.deepEqual(linuxTerminals(() => false), [])
})

test('auto keeps the platform behaviour an existing install already had', () => {
  assert.equal(autoTerminal('win32'), 'cmd')
  assert.equal(autoTerminal('darwin'), 'terminal')
  assert.equal(autoTerminal('linux'), 'x-terminal-emulator')
})
