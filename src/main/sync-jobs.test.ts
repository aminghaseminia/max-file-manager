import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanCron,
  cleanPairDirs,
  cleanSyncJob,
  cleanSyncJobs,
  isSyncPath,
  newSyncJobId,
  pairKey
} from '../shared/sync.ts'

const base = {
  id: 'job-1',
  name: 'backup',
  left: '/tmp/a',
  right: '/tmp/b',
  direction: 'ltr',
  compareBy: 'mtime'
}

test('isSyncPath: local, Windows drive, UNC and remote URIs; never a relative path', () => {
  assert.equal(isSyncPath('/tmp/a'), true)
  assert.equal(isSyncPath('C:\\Users\\a'), true)
  assert.equal(isSyncPath('C:/Users/a'), true)
  assert.equal(isSyncPath('\\\\server\\share\\x'), true)
  assert.equal(isSyncPath('sftp://user@host/srv'), true)
  assert.equal(isSyncPath('s3://bucket/prefix'), true)
  assert.equal(isSyncPath('relative/path'), false)
  assert.equal(isSyncPath(''), false)
  assert.equal(isSyncPath(null), false)
  assert.equal(isSyncPath('/' + 'x'.repeat(5000)), false)
})

test('cleanSyncJob: a valid job survives and the unknowns fall back to safe defaults', () => {
  const job = cleanSyncJob({
    ...base,
    name: '  My backup  ',
    direction: 'sideways',
    compareBy: 'ctime',
    ignore: ['*.log', '', '*.log', 'node_modules'],
    deleteExtra: 'yes',
    enabled: 'no',
    schedule: { everyMinutes: '15', cron: 'nonsense', onStart: true, onMount: 1, onChange: false }
  })
  assert.ok(job)
  assert.equal(job.name, 'My backup')
  assert.equal(job.direction, 'ltr')
  assert.equal(job.compareBy, 'mtime')
  assert.deepEqual(job.ignore, ['*.log', 'node_modules'])
  assert.equal(job.deleteExtra, false)
  assert.equal(job.enabled, true)
  assert.equal(job.schedule.everyMinutes, 15)
  assert.equal(job.schedule.cron, undefined)
  assert.equal(job.schedule.onStart, true)
  assert.equal(job.schedule.onMount, false)
})

test('cleanSyncJob: bad ids, relative paths, the same path and missing sides are rejected', () => {
  assert.equal(cleanSyncJob({ ...base, id: 'Bad Id' }), null)
  assert.equal(cleanSyncJob({ ...base, left: 'relative' }), null)
  assert.equal(cleanSyncJob({ ...base, right: base.left }), null)
  assert.equal(cleanSyncJob({ ...base, left: '' }), null)
  assert.equal(cleanSyncJob(null), null)
})

test('cleanSyncJob: everyMinutes is clamped and a valid five-field cron survives', () => {
  assert.equal(cleanSyncJob({ ...base, schedule: { everyMinutes: 0 } })?.schedule.everyMinutes, undefined)
  assert.equal(cleanSyncJob({ ...base, schedule: { everyMinutes: -5 } })?.schedule.everyMinutes, undefined)
  assert.equal(cleanSyncJob({ ...base, schedule: { everyMinutes: 999999 } })?.schedule.everyMinutes, 10080)
  assert.equal(cleanSyncJob({ ...base, schedule: { cron: '0 3 * * *' } })?.schedule.cron, '0 3 * * *')
  assert.equal(cleanCron('* * * *'), '')
  assert.equal(cleanCron('* * * * * ; rm'), '')
  assert.equal(cleanCron('*/15 9-17 * * 1-5'), '*/15 9-17 * * 1-5')
})

test('cleanSyncJobs: drops duplicates, caps the list and never throws on junk', () => {
  const jobs = cleanSyncJobs([
    base,
    { ...base, left: '/tmp/c' },
    { ...base, id: 'job-2', left: '/tmp/c' },
    { ...base, id: 'job-3', left: 'relative' }
  ])
  assert.deepEqual(jobs.map((j) => j.id), ['job-1', 'job-2'])
  assert.deepEqual(cleanSyncJobs('not an array'), [])
  assert.deepEqual(cleanSyncJobs([null, 3, 'x']), [])
})

test('newSyncJobId and pairKey are deterministic and collision-free', () => {
  assert.equal(newSyncJobId([]), 'sync-1')
  assert.equal(newSyncJobId(['sync-1', 'sync-2']), 'sync-3')
  assert.equal(pairKey('/a', '/b'), '/a\u0000/b')
})

test('cleanPairDirs: only known modes and string keys survive', () => {
  assert.deepEqual(cleanPairDirs({ '/a\u0000/b': 'both', '/c\u0000/d': 'ltr', x: 'sideways' }), {
    '/a\u0000/b': 'both',
    '/c\u0000/d': 'ltr'
  })
  assert.deepEqual(cleanPairDirs(null), {})
})
