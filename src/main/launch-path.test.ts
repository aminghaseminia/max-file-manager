import assert from 'node:assert/strict'
import test from 'node:test'
import { targetPath } from './launch-path.ts'

const APP = '/data/Codes/max-file-manager'

test('the app directory passed by the launcher is not the target', () => {
  assert.equal(targetPath(['electron', APP], APP), null)
  assert.equal(targetPath(['electron', APP, '/home/max/Downloads'], APP), '/home/max/Downloads')
})

test('a packaged launch takes the first real argument', () => {
  assert.equal(targetPath(['mfm', '/home/max/Documents'], APP), '/home/max/Documents')
  assert.equal(targetPath(['mfm'], APP), null)
})

test('file:// URIs from %U are decoded', () => {
  assert.equal(targetPath(['electron', APP, 'file:///home/max/My%20Folder'], APP), '/home/max/My Folder')
})

test('flags are ignored and the app’s own folder can still be opened explicitly', () => {
  assert.equal(targetPath(['electron', '--inspect', APP, APP], APP), APP)
})
