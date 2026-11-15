import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createEngine, type Job } from './jobs.ts'
import type { RemoteFs } from './remote-core.ts'
import { remoteDir, remoteJoin, remoteName } from '../shared/remote-path.ts'
import type { DirRef } from './types.ts'

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'mfm-r-'))
const exists = (p: string) => fs.access(p).then(() => true, () => false)

type Node = { dir: boolean; content: Buffer; mtime: number }

/** A tiny in-memory remote store that speaks the same interface the engine uses. */
function fakeRemote(): { fs: RemoteFs; nodes: Map<string, Node> } {
  const nodes = new Map<string, Node>()
  const root = 's3://test/bucket'
  nodes.set(root, { dir: true, content: Buffer.alloc(0), mtime: Date.now() })
  const folder = (uri: string): void => {
    let cur = remoteDir(uri)
    const chain: string[] = []
    while (cur && !nodes.has(cur)) {
      chain.push(cur)
      const parent = remoteDir(cur)
      if (parent === cur) break
      cur = parent
    }
    for (const p of chain.reverse()) {
      nodes.set(p, { dir: true, content: Buffer.alloc(0), mtime: Date.now() })
    }
  }
  const children = (uri: string): string[] => {
    const prefix = uri.replace(/\/+$/, '') + '/'
    const names = new Set<string>()
    for (const key of nodes.keys()) {
      if (!key.startsWith(prefix) || key === prefix) continue
      const rel = key.slice(prefix.length)
      const first = rel.split('/')[0]
      if (first) names.add(first)
    }
    return [...names]
  }
  const stat = async (uri: string) => {
    const n = nodes.get(uri)
    if (!n) return null
    return { name: remoteName(uri), dir: n.dir, size: n.content.length, mtime: n.mtime }
  }
  const adapter = {
    isRemote: () => true,
    stat,
    exists: async (uri: string) => !!nodes.get(uri),
    list: async (uri: string) => ({
      path: uri,
      parent: null,
      entries: children(uri).map((name) => {
        const child = remoteJoin(uri, name)
        const n = nodes.get(child)
        return {
          name,
          path: child,
          dir: !!n?.dir,
          size: n?.dir ? 0 : n?.content.length ?? 0,
          mtime: n?.mtime ?? 0,
          ext: name.includes('.') ? name.split('.').pop()! : ''
        }
      })
    }),
    dirs: async (uri: string): Promise<DirRef[]> =>
      children(uri)
        .map((n) => remoteJoin(uri, n))
        .filter((p) => nodes.get(p)?.dir)
        .map((p) => ({ name: remoteName(p), path: p })),
    measure: async (uri: string) => {
      const n = nodes.get(uri)
      if (!n) return { bytes: 0, files: 0, capped: false }
      if (!n.dir) return { bytes: n.content.length, files: 1, capped: false }
      let bytes = 0
      let files = 0
      for (const [key, value] of nodes) {
        if (key.startsWith(uri.replace(/\/+$/, '') + '/') && !value.dir) {
          bytes += value.content.length
          files++
        }
      }
      return { bytes, files, capped: false }
    },
    downloadFile: async (uri: string, local: string) => {
      const n = nodes.get(uri)
      if (!n || n.dir) throw new Error('not a file')
      await fs.writeFile(local, n.content)
      return { size: n.content.length }
    },
    uploadFile: async (local: string, uri: string) => {
      const buf = await fs.readFile(local)
      folder(uri)
      nodes.set(uri, { dir: false, content: buf, mtime: Date.now() })
      return { size: buf.length }
    },
    writeBuffer: async (uri: string, data: Buffer) => {
      folder(uri)
      nodes.set(uri, { dir: false, content: Buffer.from(data), mtime: Date.now() })
    },
    mkdir: async (uri: string) => {
      folder(uri)
      nodes.set(uri, { dir: true, content: Buffer.alloc(0), mtime: Date.now() })
    },
    remove: async (uri: string) => {
      const prefix = uri.replace(/\/+$/, '') + '/'
      for (const key of [...nodes.keys()]) {
        if (key === uri || key.startsWith(prefix)) nodes.delete(key)
      }
    },
    rename: async (from: string, to: string) => {
      const n = nodes.get(from)
      if (!n) throw new Error('not found')
      const prefix = from.replace(/\/+$/, '') + '/'
      const moved = [...nodes.entries()].filter(([k]) => k === from || k.startsWith(prefix))
      for (const [k, value] of moved) nodes.delete(k)
      for (const [k, value] of moved) nodes.set(to + k.slice(from.length), value)
    },
    freeName: async (uri: string) => {
      if (!nodes.has(uri)) return uri
      const dir = remoteDir(uri)
      const name = remoteName(uri)
      const dot = name.lastIndexOf('.')
      const base = dot > 0 ? name.slice(0, dot) : name
      const ext = dot > 0 ? name.slice(dot) : ''
      for (let i = 2; i < 100; i++) {
        const next = remoteJoin(dir, `${base} (${i})${ext}`)
        if (!nodes.has(next)) return next
      }
      throw new Error('no free name')
    }
  }
  return { fs: adapter as unknown as RemoteFs, nodes }
}

const engine = (remote: RemoteFs) => {
  const seen: Job[] = []
  return { e: createEngine((j) => seen.push(j), remote), seen }
}

async function settle(seen: Job[]): Promise<Job> {
  for (let i = 0; i < 400; i++) {
    const last = seen[seen.length - 1]
    if (last && ['done', 'error', 'cancelled'].includes(last.state)) return last
    await new Promise((r) => setTimeout(r, 15))
  }
  throw new Error('job did not settle')
}

test('local → remote upload lands with the same bytes', async () => {
  const { fs: rfs, nodes } = fakeRemote()
  const root = await tmp()
  const src = path.join(root, 'hello.txt')
  await fs.writeFile(src, 'hello remote')
  const dest = 's3://test/bucket/up'
  await rfs.mkdir(dest)

  const { e, seen } = engine(rfs)
  e.start('copy', [src], dest)
  const job = await settle(seen)
  assert.equal(job.state, 'done')
  assert.equal(job.bytes, 12)
  assert.equal(nodes.get('s3://test/bucket/up/hello.txt')?.content.toString(), 'hello remote')
  assert.equal(await exists(src), true)
})

test('remote → local download and name collisions get « (2) »', async () => {
  const { fs: rfs, nodes } = fakeRemote()
  const root = await tmp()
  await rfs.mkdir('s3://test/bucket/down')
  await rfs.writeBuffer('s3://test/bucket/down/a.txt', Buffer.from('from remote'))
  await fs.writeFile(path.join(root, 'a.txt'), 'local one')

  const { e, seen } = engine(rfs)
  e.start('copy', ['s3://test/bucket/down/a.txt'], root)
  const job = await settle(seen)
  assert.equal(job.state, 'done')
  assert.equal(await fs.readFile(path.join(root, 'a (2).txt'), 'utf8'), 'from remote')
  assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'local one')
  assert.ok(nodes.has('s3://test/bucket/down/a.txt'), 'a copy leaves the source')
})

test('remote → remote move and undo move the tree back', async () => {
  const { fs: rfs, nodes } = fakeRemote()
  await rfs.mkdir('s3://test/bucket/src')
  await rfs.mkdir('s3://test/bucket/src/sub')
  await rfs.writeBuffer('s3://test/bucket/src/sub/x.txt', Buffer.from('x'))
  await rfs.mkdir('s3://test/bucket/dest')

  const { e, seen } = engine(rfs)
  e.start('move', ['s3://test/bucket/src'], 's3://test/bucket/dest')
  const job = await settle(seen)
  assert.equal(job.state, 'done')
  assert.equal(nodes.has('s3://test/bucket/src'), false)
  assert.equal(nodes.get('s3://test/bucket/dest/src/sub/x.txt')?.content.toString(), 'x')

  const u = await e.undo()
  assert.equal(u.done, 1)
  assert.equal(nodes.get('s3://test/bucket/src/sub/x.txt')?.content.toString(), 'x')
  assert.equal(nodes.has('s3://test/bucket/dest/src'), false)
})

test('remote rename, mkdir and createFile go through the engine (with undo)', async () => {
  const { fs: rfs, nodes } = fakeRemote()
  const root = 's3://test/bucket'
  await rfs.writeBuffer(remoteJoin(root, 'old.txt'), Buffer.from('old'))

  const { e } = engine(rfs)
  const renamed = await e.renameMany([{ from: remoteJoin(root, 'old.txt'), to: remoteJoin(root, 'new.txt') }])
  assert.deepEqual(renamed, { done: 1, errors: [] })
  assert.ok(nodes.has(remoteJoin(root, 'new.txt')))
  assert.equal(nodes.has(remoteJoin(root, 'old.txt')), false)
  await e.undo()
  assert.ok(nodes.has(remoteJoin(root, 'old.txt')))

  assert.deepEqual(await e.makeDir(root, 'folder'), { done: 1, errors: [] })
  assert.equal(nodes.get(remoteJoin(root, 'folder'))?.dir, true)
  await e.undo()
  assert.equal(nodes.has(remoteJoin(root, 'folder')), false)

  const made = await e.createFile(root, 'note.txt', 'hello')
  assert.deepEqual(made, { done: 1, errors: [] })
  assert.equal(nodes.get(remoteJoin(root, 'note.txt'))?.content.toString(), 'hello')
  const dup = await e.createFile(root, 'note.txt', 'other')
  assert.equal(dup.done, 0)
  await e.undo()
  assert.equal(nodes.has(remoteJoin(root, 'note.txt')), false)

  const binary = await e.createFile(root, 'raw.bin', 'base64:AQIDBA==')
  assert.deepEqual(binary, { done: 1, errors: [] })
  assert.deepEqual([...nodes.get(remoteJoin(root, 'raw.bin'))!.content], [1, 2, 3, 4])
})

test('a move into a missing remote folder fails instead of guessing', async () => {
  const { fs: rfs } = fakeRemote()
  const root = await tmp()
  const src = path.join(root, 'a.txt')
  await fs.writeFile(src, 'x')
  const { e, seen } = engine(rfs)
  e.start('copy', [src], 's3://test/bucket/nope')
  const job = await settle(seen)
  assert.equal(job.state, 'error')
  assert.match(job.errors[0], /destination/)
})

test('remote paths without a remote adapter are rejected', async () => {
  const root = await tmp()
  const src = path.join(root, 'a.txt')
  await fs.writeFile(src, 'x')
  const seen: Job[] = []
  const e = createEngine((j) => seen.push(j))
  e.start('copy', [src], 's3://test/bucket/up')
  const job = await settle(seen)
  assert.equal(job.state, 'error')
  assert.match(job.errors[0], /remote/)
})
