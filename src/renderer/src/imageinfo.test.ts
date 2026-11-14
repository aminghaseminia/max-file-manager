import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NO_ADJ,
  adjustFilter,
  aspectText,
  cleanAdj,
  dominantColors,
  isNeutral,
  luminanceHistogram,
  megapixels
} from './imageinfo.ts'

test('aspectText prefers the familiar ratios and falls back to the reduced fraction', () => {
  assert.equal(aspectText(1920, 1080), '16:9')
  assert.equal(aspectText(3000, 2000), '3:2')
  assert.equal(aspectText(1000, 1000), '1:1')
  assert.equal(aspectText(4000, 3000), '4:3')
  assert.equal(aspectText(1234, 567), '1234:567')
  assert.equal(aspectText(0, 10), '—')
})

test('megapixels is width × height in millions', () => {
  assert.equal(megapixels(4000, 3000), 12)
  assert.equal(megapixels(0, 3000), 0)
})

test('adjustments clamp to their useful range and a neutral set is a no-op', () => {
  const wild = cleanAdj({ brightness: 999, contrast: -5, saturation: 400, grayscale: -3 })
  assert.deepEqual(wild, { brightness: 150, contrast: 50, saturation: 200, grayscale: 0 })
  assert.equal(isNeutral(NO_ADJ), true)
  assert.match(adjustFilter(NO_ADJ), /brightness\(100%\)/)
  assert.equal(adjustFilter(wild), 'brightness(150%) contrast(50%) saturate(200%) grayscale(0%)')
  assert.equal(isNeutral({ ...NO_ADJ, grayscale: 20 }), false)
})

test('dominantColors groups similar pixels and shares add up', () => {
  // 3 red pixels, 1 blue pixel
  const data = new Uint8ClampedArray([
    255, 0, 0, 255, 250, 4, 2, 255, 245, 3, 0, 255, 0, 0, 255, 255
  ])
  const colours = dominantColors(data, 2)
  assert.equal(colours.length, 2)
  assert.match(colours[0].hex, /^#[0-9a-f]{6}$/)
  assert.ok(colours[0].share > colours[1].share)
  assert.equal(Math.round(colours[0].share * 100), 75)
})

test('dominantColors ignores fully transparent pixels and an empty image', () => {
  assert.deepEqual(dominantColors(new Uint8ClampedArray([255, 0, 0, 0])), [])
  const two = dominantColors(new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]), 1)
  assert.equal(two.length, 1)
})

test('luminanceHistogram bins by brightness and normalises to the peak', () => {
  const data = new Uint8ClampedArray([
    0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255
  ])
  const bins = luminanceHistogram(data, 8)
  assert.equal(bins.length, 8)
  assert.equal(Math.max(...bins), 1)
  assert.ok((bins[0] ?? 0) > 0)
  assert.ok((bins[bins.length - 1] ?? 0) > 0)
  const empty = luminanceHistogram(new Uint8ClampedArray([]), 4)
  assert.deepEqual(empty, [0, 0, 0, 0])
})
