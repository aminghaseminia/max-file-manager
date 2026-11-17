import test from 'node:test'
import assert from 'node:assert/strict'
import { setLang } from './i18n.ts'
import { agoLabel, bindingSubtitle, cloudStateClass, intervalLabel } from './cloud-view.ts'

// the default UI language is English; these labels are asserted in Persian
setLang('fa')

test('ago label never shows a negative or a raw number', () => {
  const now = 10_000_000
  assert.equal(agoLabel(null, now), 'هرگز')
  assert.equal(agoLabel(now - 5_000, now), 'همین حالا')
  assert.equal(agoLabel(now - 2 * 60_000, now), '۲ دقیقه پیش')
  assert.equal(agoLabel(now - 3 * 3_600_000, now), '۳ ساعت پیش')
  assert.equal(agoLabel(now - 2 * 86_400_000, now), '۲ روز پیش')
  // a clock that went backwards must not produce a negative age
  assert.equal(agoLabel(now + 60_000, now), 'همین حالا')
})

test('intervals read as minutes below an hour and hours above', () => {
  assert.equal(intervalLabel(15 * 60_000), '۱۵ دقیقه')
  assert.equal(intervalLabel(3 * 3_600_000), '۳ ساعت')
})

test('state maps to a css class and a subtitle', () => {
  assert.equal(cloudStateClass('syncing'), 'is-busy')
  assert.equal(cloudStateClass('conflict'), 'is-conflict')
  assert.equal(cloudStateClass('nope'), 'is-synced')
  assert.equal(bindingSubtitle('syncing', null, 0), 'در حال همگام‌سازی…')
  assert.equal(bindingSubtitle('idle', null, 2), '۲ تعارض')
})
