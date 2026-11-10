import assert from 'node:assert/strict'
import test from 'node:test'
import { accelFromEvent, findConflicts, formatAccel, matchAccel, parseAccel } from './keys.ts'

const ev = (o: Partial<KeyboardEvent>) => o as KeyboardEvent

test('parseAccel reads modifiers and named keys', () => {
  assert.deepEqual(parseAccel('F5'), { ctrl: false, shift: false, alt: false, key: 'F5' })
  assert.deepEqual(parseAccel('Ctrl+Shift+F'), { ctrl: true, shift: true, alt: false, key: 'F' })
  assert.deepEqual(parseAccel('Shift+Delete'), { ctrl: false, shift: true, alt: false, key: 'Delete' })
  assert.equal(parseAccel('Space').key, 'Space')
})

test('matchAccel respects every modifier', () => {
  assert.equal(matchAccel('F5', ev({ key: 'F5' })), true)
  assert.equal(matchAccel('F5', ev({ key: 'F5', ctrlKey: true })), false)
  assert.equal(matchAccel('Ctrl+F5', ev({ key: 'F5', ctrlKey: true })), true)
  assert.equal(matchAccel('Ctrl+Shift+F', ev({ key: 'f', ctrlKey: true, shiftKey: true })), true)
  assert.equal(matchAccel('Ctrl+Shift+F', ev({ key: 'f', ctrlKey: true })), false)
  assert.equal(matchAccel('Space', ev({ key: ' ' })), true)
  assert.equal(matchAccel('', ev({ key: 'a' })), false)
})

test('accelFromEvent builds a storable string', () => {
  assert.equal(accelFromEvent(ev({ key: 'F7' })), 'F7')
  assert.equal(accelFromEvent(ev({ key: 'z', ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+Z')
  assert.equal(accelFromEvent(ev({ key: ' ' })), 'Space')
  assert.equal(accelFromEvent(ev({ key: 'Control', ctrlKey: true })), null, 'a bare modifier is not a shortcut')
})

test('formatAccel is stable and round-trips', () => {
  assert.equal(formatAccel('Ctrl+Shift+F'), 'Ctrl + Shift + F')
  assert.equal(formatAccel(accelFromEvent(ev({ key: 'F9' }))!), 'F9')
})

test('findConflicts reports every id sharing a key', () => {
  const bad = findConflicts({ copy: 'F5', move: 'F5', trash: 'F8' })
  assert.deepEqual(bad.sort(), ['copy', 'move'])
  assert.deepEqual(findConflicts({ copy: 'F5', move: 'F6' }), [])
  assert.deepEqual(findConflicts({ a: '', b: '' }), [])
})
