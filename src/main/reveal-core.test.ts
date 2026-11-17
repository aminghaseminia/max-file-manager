import assert from 'node:assert/strict'
import test from 'node:test'
import { selectCommand } from './reveal-core.ts'

const only = (...bins: string[]) => (bin: string) => bins.includes(bin)

test('selectCommand: asks the manager the session actually ships for', () => {
  const file = '/home/maxv/Downloads/0bb082bba5a646048b5c3984.mp3'
  assert.deepEqual(selectCommand(file, 'KDE', only('dolphin', 'nautilus')), {
    cmd: 'dolphin',
    args: ['--select', file]
  })
  assert.deepEqual(selectCommand(file, 'ubuntu:GNOME', only('dolphin', 'nautilus')), {
    cmd: 'nautilus',
    args: ['--select', file]
  })
  assert.equal(selectCommand(file, 'X-Cinnamon', only('nautilus', 'nemo'))?.cmd, 'nemo')
  assert.equal(selectCommand(file, 'MATE', only('nautilus', 'caja'))?.cmd, 'caja')
})

test('selectCommand: a preferred manager that is not installed yields to any other', () => {
  assert.equal(selectCommand('/tmp/a b/c.txt', 'ubuntu:GNOME', only('dolphin'))?.cmd, 'dolphin')
  assert.equal(selectCommand('/tmp/x', '', only('nemo'))?.cmd, 'nemo')
})

test('selectCommand: no known file manager means no command, so the caller falls back', () => {
  assert.equal(selectCommand('/tmp/x', 'KDE', only('thunar', 'pcmanfm')), null)
})

test('selectCommand: the path is passed untouched (spaces and quotes included)', () => {
  const file = "/tmp/it's a b/فایل.txt"
  assert.deepEqual(selectCommand(file, 'KDE', only('dolphin'))?.args, ['--select', file])
})
