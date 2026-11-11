import assert from 'node:assert/strict'
import test from 'node:test'
import { isNewer, pickLatest } from './updates-core.ts'

test('isNewer compares dotted versions numerically', () => {
  assert.equal(isNewer('1.2.10', '1.2.9'), true, '10 > 9 is numeric, not lexical')
  assert.equal(isNewer('v2.0.0', '1.99.99'), true, 'the v prefix is tolerated')
  assert.equal(isNewer('1.0.0', '1.0.0'), false)
  assert.equal(isNewer('1.0.0-beta', '1.0.0'), false, 'a tag suffix does not make it newer')
  assert.equal(isNewer('0.23.1', '0.23'), true, 'missing segments count as zero')
})

test('pickLatest skips drafts and prereleases and takes the highest tag', () => {
  const best = pickLatest([
    { tag_name: 'v0.2.0', html_url: 'u2', body: 'notes 2' },
    { tag_name: 'v0.1.0', html_url: 'u1' },
    { tag_name: 'v0.3.0', html_url: 'u3', draft: true },
    { tag_name: 'v0.4.0', html_url: 'u4', prerelease: true },
    {}
  ])
  assert.deepEqual(best, { tag: 'v0.2.0', url: 'u2', notes: 'notes 2' })
  assert.equal(pickLatest([]), null)
  assert.equal(pickLatest([{ draft: true }]), null)
})
