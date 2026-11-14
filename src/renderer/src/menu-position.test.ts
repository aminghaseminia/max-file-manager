import assert from 'node:assert/strict'
import test from 'node:test'
import { submenuLeft } from './menu-position.ts'

const anchor = { left: 500, right: 748 }

test('a submenu opens on the preferred side when it fits', () => {
  // RTL prefers the left of the item, LTR the right
  assert.equal(submenuLeft(anchor, 248, 1100, true), 248)
  assert.equal(submenuLeft(anchor, 248, 1100, false), 752)
})

test('no room on the preferred side flips it to the other side', () => {
  // RTL: item hugs the left edge → left is impossible, so open to the right
  assert.equal(submenuLeft({ left: 40, right: 288 }, 248, 1000, true), 292)
  // LTR: item hugs the right edge → right is impossible, so open to the left
  assert.equal(submenuLeft({ left: 700, right: 948 }, 248, 1000, false), 448)
})

test('when neither side fits the preferred side is clamped into the viewport', () => {
  assert.equal(submenuLeft({ left: 40, right: 288 }, 400, 300, true, 4, 8), 8)
})
