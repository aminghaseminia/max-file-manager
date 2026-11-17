/**
 * The cloud half of `PathOps`. Everything above it — the walk, the three-way comparison, the plan,
 * the baseline, the conflict rules — is the existing sync engine; this file only teaches it how to
 * read and write one binding.
 *
 * `cloud://<bindingId>/<rel>` is a virtual path: it never reaches the local `fs` and it is the only
 * thing the engine has to understand about the remote side.
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hashFile } from './hash.ts'
import { cloudOf, cloudPath, isCloudPath, type CloudBinding } from '../shared/cloud.ts'
import { remoteJoin } from './cloud-core.ts'
import type { DavClient } from './cloud-dav.ts'
import type { PathOps } from './sync-engine.ts'
import type { Entry } from './types.ts'

const normRel = (rel: string): string => rel.replace(/^\/+/, '').replace(/\/+$/, '')

export function cloudOps(binding: CloudBinding, dav: DavClient, tempRoot = os.tmpdir()): PathOps {
  /** The DAV path of a binding-relative path. '' is the binding's own folder. */
  const davPath = (rel: string): string => {
    const clean = normRel(rel)
    return clean ? remoteJoin(binding.remoteId, clean) : binding.remoteId
  }

  const relOf = (p: string): string => {
    const parsed = cloudOf(p)
    if (!parsed || parsed.bindingId !== binding.id) throw new Error(`not part of this cloud binding: ${p}`)
    return normRel(parsed.rel)
  }

  /** WebDAV needs every parent collection before a file can be PUT. */
  const made = new Set<string>([''])
  const ensureDir = async (rel: string): Promise<void> => {
    const clean = normRel(rel)
    if (!clean || made.has(clean)) return
    const parent = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : ''
    if (parent) await ensureDir(parent)
    const target = davPath(clean)
    const st = await dav.stat(target)
    if (!st) await dav.mkdir(target)
    else if (!st.dir) throw new Error(`a file is in the way of a folder: ${clean}`)
    made.add(clean)
  }

  const tempFile = async (suffix = '.bin'): Promise<string> => {
    const dir = await fs.mkdtemp(path.join(tempRoot, 'mfm-cloud-'))
    return path.join(dir, `blob${suffix}`)
  }

  const ops: PathOps = {
    isRemote: isCloudPath,

    join: (dir, name) => `${dir.replace(/\/+$/, '')}/${name}`,
    joinRel: (root, rel) => `${root.replace(/\/+$/, '')}/${normRel(rel)}`.replace(/\/+$/, ''),

    async stat(p) {
      const rel = relOf(p)
      const st = await dav.stat(davPath(rel))
      if (!st) return null
      // a folder's size is not meaningful on DAV; the tree walk only needs the flag
      // 0 means «the server sent no timestamp»; inventing one would make every run look changed
      return { size: st.dir ? 0 : st.size, mtime: st.mtime, dir: st.dir }
    },

    async list(p) {
      const rel = relOf(p)
      const rows = await dav.list(davPath(rel))
      const out: Entry[] = []
      for (const row of rows) {
        const childRel = normRel(rel ? `${rel}/${row.name}` : row.name)
        out.push({
          name: row.name,
          path: cloudPath(binding.id, childRel),
          dir: row.dir,
          size: row.dir ? 0 : row.size,
          mtime: row.mtime,
          ext: row.dir ? '' : path.extname(row.name).slice(1).toLowerCase()
        })
      }
      return out
    },

    async hash(p) {
      const rel = relOf(p)
      const tmp = await tempFile()
      try {
        await dav.download(davPath(rel), tmp)
        return (await hashFile(tmp)) ?? ''
      } finally {
        await fs.rm(path.dirname(tmp), { recursive: true, force: true }).catch(() => undefined)
      }
    },

    async copy(from, to, ctl) {
      if (ctl?.cancelled) throw new Error('cancelled')
      const fromCloud = isCloudPath(from)
      const toCloud = isCloudPath(to)
      const onBytes = ctl?.onBytes
      if (fromCloud && !toCloud) {
        await fs.mkdir(path.dirname(to), { recursive: true })
        await dav.download(davPath(relOf(from)), to, onBytes)
        return
      }
      if (!fromCloud && toCloud) {
        const rel = relOf(to)
        const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
        await ensureDir(parent)
        const st = await fs.stat(from)
        await dav.upload(from, davPath(rel), st.mtimeMs, onBytes)
        return
      }
      if (fromCloud && toCloud) {
        const tmp = await tempFile()
        try {
          await dav.download(davPath(relOf(from)), tmp, onBytes)
          const rel = relOf(to)
          const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
          await ensureDir(parent)
          const st = await fs.stat(tmp)
          await dav.upload(tmp, davPath(rel), st.mtimeMs)
        } finally {
          await fs.rm(path.dirname(tmp), { recursive: true, force: true }).catch(() => undefined)
        }
        return
      }
      // neither side is a cloud path: the combined ops should have routed this to localOps
      throw new Error('cloud copy needs at least one cloud side')
    },

    async remove(p) {
      const target = davPath(relOf(p))
      try {
        await dav.remove(target)
      } catch (e) {
        // some servers refuse to delete a non-empty collection; empty it first, then retry once
        const rows = await dav.list(target).catch(() => [])
        if (!rows.length) throw e
        for (const row of rows) await dav.remove(row.path)
        await dav.remove(target)
      }
    },

    // The source timestamp travels in `X-OC-Mtime` on upload; a plain WebDAV server ignores it,
    // which is why the binding compares by hash by default.
    setMtime: async () => undefined
  }
  return ops
}
