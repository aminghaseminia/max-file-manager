import assert from 'node:assert/strict'
import test from 'node:test'
import { fitWindow } from './window-bounds.ts'

const primary = { x: 0, y: 0, width: 1920, height: 1080 }
const second = { x: 1920, y: 0, width: 1280, height: 1024 }
const defaults = { width: 1320, height: 860, minWidth: 780, minHeight: 480 }

test('no saved bounds: the default size centred on the primary screen', () => {
  assert.deepEqual(fitWindow(null, [primary], primary, defaults), {
    x: 300,
    y: 110,
    width: 1320,
    height: 860
  })
})

test('a rectangle on a connected screen is restored exactly', () => {
  const saved = { x: 100, y: 80, width: 1000, height: 700 }
  assert.deepEqual(fitWindow(saved, [primary, second], primary, defaults), saved)
})

test('a window on the second screen stays there', () => {
  const saved = { x: 2100, y: 120, width: 900, height: 600 }
  assert.deepEqual(fitWindow(saved, [primary, second], primary, defaults), saved)
})

test('an unplugged screen lands centred on the main screen with its size', () => {
  const saved = { x: 3000, y: 200, width: 900, height: 600 }
  assert.deepEqual(fitWindow(saved, [primary], primary, defaults), {
    x: 510,
    y: 240,
    width: 900,
    height: 600
  })
})

test('a rectangle half off the edge is pulled back inside the work area', () => {
  const saved = { x: 1800, y: 900, width: 900, height: 600 }
  assert.deepEqual(fitWindow(saved, [primary], primary, defaults), {
    x: 1020,
    y: 480,
    width: 900,
    height: 600
  })
})

test('a size bigger than the screen is clamped, never negative or outside', () => {
  const saved = { x: 10, y: 10, width: 4000, height: 3000 }
  const got = fitWindow(saved, [primary], primary, defaults)
  assert.equal(got.width, 1920)
  assert.equal(got.height, 1080)
  assert.equal(got.x, 0)
  assert.equal(got.y, 0)
})

test('a sliver that barely touches a screen counts as gone', () => {
  const saved = { x: 1910, y: 20, width: 800, height: 600 }
  const got = fitWindow(saved, [primary], primary, defaults)
  assert.equal(got.x, 560, 'centred instead of hugging the edge')
})
