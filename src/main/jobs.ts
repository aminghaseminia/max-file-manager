import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { freeName } from './ops.ts'
import type { Result } from './types.ts'

export type JobKind = 'copy' | 'move'
export type JobState = 'queued' | 'running' | 'paused' | 'done' | 'cancelled' | 'error'

export type Job = {
  id: string
  kind: JobKind
  label: string
  state: JobState
  bytes: number
  done: number
  files: number
  filesDone: number
  speed: number
  current: string
  errors: string[]
  /** sources left alone by the transfer filters */
  skipped: number
}

/** Transfer filters the user can set in preferences. */
export type JobOpts = {
  /** a name that already exists in the destination is left alone instead of becoming "name (2)" */
  skipExisting?: boolean
  /** only copy when the source is newer than the existing destination file */
  newerOnly?: boolean
  /** bytes per second ceiling, 0 or missing = unlimited */
  limitBps?: number
}

type Ctl = { paused: boolean; cancelled: boolean; limitBps?: number }
type UndoRec = { label: string; pairs: [string, string][]; inverse: 'rename' | 'rmdir' }

export type Engine = {
  start(kind: JobKind, sources: string[], dest: string, opts?: JobOpts): Job
  pause(id: string): void
  resume(id: string): void
  cancel(id: string): void
  list(): Job[]
  clear(): void
  renameMany(pairs: { from: string; to: string }[]): Promise<Result>
  makeDir(dir: string, name: string): Promise<Result>
  undo(): Promise<{ done: number; label: string }>
  undoDepth(): number
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function measure(p: string): Promise<{ bytes: number; files: number }> {
  const st = await fs.lstat(p).catch(() => null)
  if (!st) return { bytes: 0, files: 1 }
  if (!st.isDirectory()) return { bytes: st.size, files: 1 }
  let bytes = 0
  let files = 0
  const stack = [p]
  while (stack.length) {
    const d = stack.pop()!
    const kids = await fs.readdir(d, { withFileTypes: true }).catch(() => [])
    for (const k of kids) {
      const q = path.join(d, k.name)
      if (k.isDirectory()) stack.push(q)
      else {
        const s = await fs.lstat(q).catch(() => null)
        if (s) {
          bytes += s.size
          files++
        }
      }
    }
  }
  return { bytes, files }
}

async function copyFile(
  src: string,
  dest: string,
  ctl: Ctl,
  onBytes: (n: number) => void,
  onFile: () => void
): Promise<void> {
  const rs = createReadStream(src, { highWaterMark: 1 << 20 })
  const ws = createWriteStream(dest)
  let aborted = false
  let sent = 0
  const startedAt = Date.now()
  try {
    for await (const chunk of rs) {
      if (ctl.cancelled) {
        aborted = true
        break
      }
      while (ctl.paused && !ctl.cancelled) await sleep(100)
      if (ctl.cancelled) {
        aborted = true
        break
      }
      const buf = chunk as Buffer
      if (!ws.write(buf)) await new Promise<void>((r) => ws.once('drain', () => r()))
      onBytes(buf.length)
      // shortcut: pacing is a sleep after each chunk, so the rate is a rough average, fine for a UI limit
      if (ctl.limitBps && ctl.limitBps > 0) {
        sent += buf.length
        const due = (sent / ctl.limitBps) * 1000
        const spent = Date.now() - startedAt
        if (due > spent) await sleep(Math.min(500, due - spent))
      }
    }
  } finally {
    if (aborted) {
      rs.destroy()
      ws.destroy()
      await fs.unlink(dest).catch(() => {})
      throw new Error('cancelled')
    }
  }
  await new Promise<void>((resolve, reject) => {
    ws.end(() => resolve())
    ws.on('error', reject)
  })
  const st = await fs.stat(src).catch(() => null)
  if (st) await fs.utimes(dest, st.atime, st.mtime).catch(() => {})
  onFile()
}

async function copyTree(
  src: string,
  dest: string,
  ctl: Ctl,
  onBytes: (n: number) => void,
  onFile: () => void
): Promise<void> {
  if (ctl.cancelled) throw new Error('cancelled')
  const st = await fs.lstat(src)
  if (st.isSymbolicLink()) {
    await fs.symlink(await fs.readlink(src), dest)
    onFile()
    return
  }
  if (st.isDirectory()) {
    await fs.mkdir(dest, { recursive: true })
    for (const k of await fs.readdir(src)) {
      await copyTree(path.join(src, k), path.join(dest, k), ctl, onBytes, onFile)
    }
    return
  }
  await copyFile(src, dest, ctl, onBytes, onFile)
}

// shortcut: cancelled transfers leave a partially filled directory (files are removed, dirs are not) and undo only covers move/rename/mkdir; upgrade when transfers get a journal.
export function createEngine(emit: (job: Job) => void): Engine {
  const jobs = new Map<string, Job>()
  const ctls = new Map<string, Ctl>()
  const undoStack: UndoRec[] = []
  let chained: Promise<void> = Promise.resolve()
  let seq = 0

  const clone = (j: Job): Job => ({ ...j, errors: [...j.errors] })
  const lastEmit = new Map<string, number>()
  const push = (job: Job, force = false) => {
    const now = Date.now()
    if (!force && now - (lastEmit.get(job.id) ?? 0) < 120) return
    lastEmit.set(job.id, now)
    emit(clone(job))
  }
  const undoPush = (label: string, pairs: [string, string][], inverse: UndoRec['inverse'] = 'rename') => {
    undoStack.push({ label, pairs, inverse })
    if (undoStack.length > 20) undoStack.shift()
  }

  function start(kind: JobKind, sources: string[], dest: string, opts: JobOpts = {}): Job {
    const job: Job = {
      id: 'j' + ++seq,
      kind,
      label: '',
      state: 'queued',
      bytes: 0,
      done: 0,
      files: 0,
      filesDone: 0,
      speed: 0,
      current: '',
      errors: [],
      skipped: 0
    }
    const ctl: Ctl = { paused: false, cancelled: false, limitBps: opts.limitBps ?? 0 }
    jobs.set(job.id, job)
    ctls.set(job.id, ctl)
    push(job, true)

    chained = chained.then(async () => {
      if (ctl.cancelled) {
        job.state = 'cancelled'
        push(job, true)
        return
      }
      job.state = 'running'
      job.label = sources.length === 1 ? path.basename(sources[0]) : `${sources.length} مورد`
      push(job, true)

      const pairs: [string, string][] = []
      try {
        if (!path.isAbsolute(dest)) throw new Error('no destination')
        for (const s of sources) {
          const natural = path.join(dest, path.basename(s))
          if (opts.skipExisting || opts.newerOnly) {
            const there = await fs.stat(natural).catch(() => null)
            if (there) {
              if (opts.skipExisting) {
                job.skipped++
                continue
              }
              const here = await fs.stat(s).catch(() => null)
              if (here && there.mtimeMs >= here.mtimeMs) {
                job.skipped++
                continue
              }
              // newerOnly and the destination is older: this run replaces it on purpose
              pairs.push([s, natural])
              continue
            }
          }
          pairs.push([s, await freeName(natural)])
          const m = await measure(s)
          job.bytes += m.bytes
          job.files += m.files
        }
      } catch (e: any) {
        job.state = 'error'
        job.errors.push(String(e?.message ?? e))
        push(job, true)
        return
      }
      push(job, true)

      let lastBytes = 0
      let lastAt = Date.now()
      const timer = setInterval(() => {
        const now = Date.now()
        job.speed = Math.round((job.done - lastBytes) / Math.max(0.2, (now - lastAt) / 1000))
        lastBytes = job.done
        lastAt = now
        push(job)
      }, 500)

      const movedPairs: [string, string][] = []
      try {
        for (const [src, target] of pairs) {
          if (ctl.cancelled) break
          job.current = path.basename(src)
          push(job, true)
          try {
            await copyTree(
              src,
              target,
              ctl,
              (n) => {
                job.done += n
                push(job)
              },
              () => {
                job.filesDone++
                push(job)
              }
            )
            if (kind === 'move') {
              await fs.rm(src, { recursive: true, force: true })
              movedPairs.push([src, target])
            }
          } catch (e: any) {
            if (ctl.cancelled) break
            job.errors.push(`${path.basename(src)}: ${e?.message ?? String(e)}`)
          }
        }
        if (movedPairs.length) undoPush(`انتقال ${movedPairs.length} مورد`, movedPairs)
        job.state = ctl.cancelled ? 'cancelled' : job.errors.length ? 'error' : 'done'
      } catch (e: any) {
        job.state = 'error'
        job.errors.push(String(e?.message ?? e))
      } finally {
        clearInterval(timer)
        job.speed = 0
        push(job, true)
      }
    })
    return clone(job)
  }

  function setPause(id: string, paused: boolean) {
    const ctl = ctls.get(id)
    const job = jobs.get(id)
    if (!ctl || !job || (job.state !== 'running' && job.state !== 'paused')) return
    ctl.paused = paused
    job.state = paused ? 'paused' : 'running'
    push(job, true)
  }

  return {
    start,
    pause: (id) => setPause(id, true),
    resume: (id) => setPause(id, false),
    cancel: (id) => {
      const ctl = ctls.get(id)
      if (ctl) ctl.cancelled = true
    },
    list: () => [...jobs.values()].map(clone),
    clear: () => {
      for (const [id, j] of jobs) if (j.state !== 'running' && j.state !== 'paused') jobs.delete(id)
    },
    renameMany: async (pairs) => {
      const errors: string[] = []
      const donePairs: [string, string][] = []
      for (const { from, to } of pairs) {
        try {
          if (!path.isAbsolute(from) || !path.isAbsolute(to)) throw new Error('not an absolute path')
          await fs.rename(from, to)
          donePairs.push([from, to])
        } catch (e: any) {
          errors.push(`${path.basename(from)}: ${e?.message ?? String(e)}`)
        }
      }
      if (donePairs.length) undoPush(`${donePairs.length} تغییر نام`, donePairs)
      return { done: donePairs.length, errors }
    },
    makeDir: async (dir, name) => {
      try {
        if (!path.isAbsolute(dir)) throw new Error('not an absolute path')
        const target = path.join(dir, name)
        await fs.mkdir(target)
        undoPush(`پوشهٔ ${name}`, [[target, target]], 'rmdir')
        return { done: 1, errors: [] }
      } catch (e: any) {
        return { done: 0, errors: [`${name}: ${e?.message ?? String(e)}`] }
      }
    },
    undo: async () => {
      const rec = undoStack.pop()
      if (!rec) return { done: 0, label: '' }
      let done = 0
      for (const [from, to] of [...rec.pairs].reverse()) {
        try {
          if (rec.inverse === 'rmdir') {
            await fs.rmdir(from)
          } else {
            try {
              await fs.rename(to, from)
            } catch (e: any) {
              if (e?.code !== 'EXDEV') throw e
              await fs.cp(to, from, { recursive: true }) // cross-device move: copy back, then drop
              await fs.rm(to, { recursive: true, force: true })
            }
          }
          done++
        } catch {
          // keep going: one unrestorable item must not block the rest
        }
      }
      return { done, label: rec.label }
    },
    undoDepth: () => undoStack.length
  }
}
