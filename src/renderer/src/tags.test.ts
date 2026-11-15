import assert from 'node:assert/strict'
import test from 'node:test'
import { autoTracks, commonValues, tagPlan } from './tags.ts'

const file = (path: string, fields: Record<string, string>) => ({ path, fields })

test('commonValues: identical values stay, differences become mixed', () => {
  assert.deepEqual(commonValues([]), { value: '', mixed: false })
  assert.deepEqual(commonValues(['A', 'A']), { value: 'A', mixed: false })
  assert.deepEqual(commonValues(['A', 'B']), { value: '', mixed: true })
  assert.deepEqual(commonValues(['', '']), { value: '', mixed: false })
  assert.deepEqual(commonValues(['', 'B']), { value: '', mixed: true })
})

test('autoTracks numbers the current order', () => {
  assert.deepEqual(autoTracks(3), ['1', '2', '3'])
  assert.deepEqual(autoTracks(3, 7), ['7', '8', '9'])
  assert.deepEqual(autoTracks(0), [])
  assert.deepEqual(autoTracks(-4), [])
  assert.deepEqual(autoTracks(2.9, 1.9), ['1', '2'])
})

test('one file writes every dialog field (unchanged values are dropped)', () => {
  const plan = tagPlan({
    files: [file('/a.mp3', { title: 'Old', artist: 'Same', album: 'Same album' })],
    common: { title: 'New', artist: 'Same', album: 'Same album', year: '1403' },
    dirty: ['title'],
    rows: {}
  })
  assert.deepEqual(plan, [{ path: '/a.mp3', fields: { title: 'New', year: '1403' } }])
})

test('one file also writes track and trackTotal', () => {
  const plan = tagPlan({
    files: [file('/a.mp3', { title: 'T' })],
    common: { title: 'T', track: '3', trackTotal: '12' },
    dirty: [],
    rows: {}
  })
  assert.deepEqual(plan, [{ path: '/a.mp3', fields: { track: '3', trackTotal: '12' } }])
})

test('a shared field reaches every file only when it is dirty', () => {
  const files = [file('/a.mp3', { artist: 'A' }), file('/b.mp3', { artist: 'B' })]
  const untouched = tagPlan({ files, common: { artist: 'Common' }, dirty: [], rows: {} })
  assert.deepEqual(untouched, [
    { path: '/a.mp3', fields: {} },
    { path: '/b.mp3', fields: {} }
  ])

  const touched = tagPlan({ files, common: { artist: 'Common' }, dirty: ['artist'], rows: {} })
  assert.deepEqual(touched, [
    { path: '/a.mp3', fields: { artist: 'Common' } },
    { path: '/b.mp3', fields: { artist: 'Common' } }
  ])
})

test('mixed values stay untouched until the field is dirty', () => {
  const files = [file('/a.mp3', { title: 'A' }), file('/b.mp3', { title: 'B' })]
  const mixed = commonValues(files.map((f) => f.fields.title))
  assert.deepEqual(mixed, { value: '', mixed: true })
  assert.deepEqual(tagPlan({ files, common: { title: mixed.value }, dirty: [], rows: {} }), [
    { path: '/a.mp3', fields: {} },
    { path: '/b.mp3', fields: {} }
  ])
  assert.deepEqual(tagPlan({ files, common: { title: 'Both' }, dirty: ['title'], rows: {} }), [
    { path: '/a.mp3', fields: { title: 'Both' } },
    { path: '/b.mp3', fields: { title: 'Both' } }
  ])
})

test('an empty dirty value clears the frame on every file', () => {
  const files = [file('/a.mp3', { album: 'One' }), file('/b.mp3', { album: 'Two' })]
  assert.deepEqual(tagPlan({ files, common: { album: '' }, dirty: ['album'], rows: {} }), [
    { path: '/a.mp3', fields: { album: '' } },
    { path: '/b.mp3', fields: { album: '' } }
  ])
})

test('a per-file row wins over the shared value', () => {
  const files = [file('/a.mp3', { title: 'A' }), file('/b.mp3', { title: 'B' })]
  assert.deepEqual(
    tagPlan({
      files,
      common: { title: 'Common', track: '1' },
      dirty: ['title', 'track'],
      rows: { '/b.mp3': { title: 'Row B', track: '9' } }
    }),
    [
      { path: '/a.mp3', fields: { title: 'Common' } },
      { path: '/b.mp3', fields: { title: 'Row B', track: '9' } }
    ]
  )
})

test('a file that changed nothing still appears with empty fields (locked behaviour)', () => {
  const files = [file('/a.mp3', { title: 'A' }), file('/b.mp3', { title: 'B' })]
  const plan = tagPlan({ files, common: {}, dirty: [], rows: { '/a.mp3': { title: 'A' } } })
  assert.equal(plan.length, 2)
  assert.deepEqual(plan[0], { path: '/a.mp3', fields: {} })
  assert.deepEqual(plan[1], { path: '/b.mp3', fields: {} })
})
