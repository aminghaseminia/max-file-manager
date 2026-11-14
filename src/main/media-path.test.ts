import assert from 'node:assert/strict'
import test from 'node:test'
import { mediaPathFromUrl } from './media-path.ts'

test('mediaPathFromUrl keeps POSIX paths intact', () => {
  assert.equal(mediaPathFromUrl('mfm://local/home/max/pic.png'), '/home/max/pic.png')
  assert.equal(mediaPathFromUrl('thumb://local/a%20b/c.png?s=128'), '/a b/c.png')
  assert.equal(mediaPathFromUrl('mfm://local/%D8%B9%DA%A9%D8%B3.png'), '/عکس.png')
})

test('mediaPathFromUrl drops the slash that made a Windows drive path relative', () => {
  assert.equal(mediaPathFromUrl('mfm://local/C:/Users/max/pic.png'), 'C:/Users/max/pic.png')
  assert.equal(mediaPathFromUrl('mfm://local/D:/Cloud/Pictures/a%20b.png?v=1'), 'D:/Cloud/Pictures/a b.png')
  assert.equal(mediaPathFromUrl('thumb://local/c:/tmp/x.png?s=256&v=5'), 'c:/tmp/x.png')
  assert.equal(mediaPathFromUrl('mfm://local/C:/'), 'C:/')
})

test('mediaPathFromUrl refuses junk instead of guessing', () => {
  assert.equal(mediaPathFromUrl('not a url'), '')
  assert.equal(mediaPathFromUrl('mfm://local/'), '/')
})
