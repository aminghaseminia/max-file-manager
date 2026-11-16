/**
 * The sync service: saved jobs, the run queue, the scheduler, history and restore. It is the only
 * place that turns a comparison into disk changes, so IPC and MCP cannot drift.
 *
 * Nothing here is a second file-operation implementation: the engine's `applyPlan` does the work
 * and the existing transfer engine is untouched. Local deletions always go through the injected
 * trash; a remote deletion is permanent and needs `confirmRemoteDelete`.
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { RemoteFs } from './remote-core.ts'
import { readStore, writeStore } from './store.ts'
import type {
  RsyncOptions,
  SyncCompareBy,
  SyncEncryption,
  SyncJob,
  SyncMode,
  SyncPlan,
  SyncProgress,
  SyncVersions,
  SyncRow,
  SyncRunSummary,
  SyncSnapshot
} from '../shared/sync.ts'
import { cleanRsyncOptions, cleanSyncJob, cleanSyncJobs, newSyncJobId, pairKey } from '../shared/sync.ts'
import { invertPlan, nextBaseline, planRows, type Baseline } from './sync-core.ts'
import { applyPlan, compareTrees, createOps, type ApplyResult, type CompareResult, type SyncControl } from './sync-engine.ts'
import { clearBaseline as clearStoredBaseline, getRun, listRuns, loadBaseline, pruneRuns, saveBaseline, saveRun } from './sync-store.ts'
import { isDue, nextDueAt } from './sync-schedule.ts'
import { applyRsync, planRsync, rsyncAvailable, trashDirFor, type RsyncRequest } from './sync-rsync.ts'
import { getSyncSecret } from './sync-secrets.ts'
import { recipientOf, type ResolvedEncryption } from './sync-crypt.ts'
import {
  VERSION_TAG,
  backup as resticBackup,
  forget as resticForget,
  resticAvailable,
  restoreToTemp as resticRestore,
  snapshots as resticSnapshots
} from './sync-versions.ts'
import { watch as fsWatch } from 'node:fs'
import { isRemotePath } from '../shared/remote-path.ts'

export type SyncDeps = {
  remote?: RemoteFs
  trash(p: string): Promise<void>
  emit(channel: string, payload: unknown): void
}

export type CompareOptions = {
  left: string
  right: string
  mode: SyncMode
  compareBy: SyncCompareBy
  ignore?: string[]
  /** optional rsync engine; local ↔ local one-way only */
  useRsync?: boolean
  rsync?: RsyncOptions
  /** per-side content encryption; the secret material is looked up by id in main */
  enc?: { left?: SyncEncryption; right?: SyncEncryption }
  /** restic history for a local one-way destination */
  versions?: SyncVersions
}

export type RunOptions = CompareOptions & {
  jobId?: string
  deleteExtra?: boolean
  /** relative paths the user ticked; undefined means all */
  selected?: string[]
  resolutions?: Record<string, 'left' | 'right' | 'skip'>
  dryRun?: boolean
  /** a plan that would delete on a remote side is refused unless this is explicitly true */
  confirmRemoteDelete?: boolean
  onPlan?(rows: SyncRow[], plan: SyncPlan, cmp: CompareResult): void
}

export type RunResult = {
  id: string
  rows: SyncRow[]
  plan: SyncPlan
  cmp: CompareResult
  applied: ApplyResult | null
  summary: SyncRunSummary
  blocked: boolean
}

const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`

const prefsState = (): { state: Record<string, unknown>; prefs: Record<string, unknown> } => {
  const state = (readStore<Record<string, unknown>>('state') ?? {}) as Record<string, unknown>
  const prefs = state.prefs && typeof state.prefs === 'object' ? (state.prefs as Record<string, unknown>) : {}
  return { state, prefs }
}

const progressEvery = 450

export function createSyncService(deps: SyncDeps) {
  let remote = deps.remote
  let active: { id: string; control: SyncControl; paused: boolean; progress?: SyncProgress } | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let tickBusy = false
  const lastRun = new Map<string, number>()
  const startedJobs = new Set<string>()
  const watchers = new Map<string, { close(): void; timer: ReturnType<typeof setTimeout> | null }>()
  const changeTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const ops = () => createOps(remote)

  const setRemote = (next: RemoteFs | undefined): void => {
    remote = next
  }

  // ── jobs ──────────────────────────────────────────────────────────────────────────────────
  const listJobs = (): SyncJob[] => {
    try {
      return cleanSyncJobs(prefsState().prefs.syncJobs)
    } catch {
      return []
    }
  }

  const writeJobs = (jobs: SyncJob[]): SyncJob[] => {
    const { state, prefs } = prefsState()
    const clean = cleanSyncJobs(jobs)
    writeStore('state', { ...state, prefs: { ...prefs, syncJobs: clean } })
    deps.emit('sync:jobs', clean)
    syncWatchers()
    return clean
  }

  const upsertJob = (draft: unknown): SyncJob | null => {
    const existing = listJobs()
    const id = (draft && typeof draft === 'object' && typeof (draft as { id?: unknown }).id === 'string'
      ? (draft as { id: string }).id
      : '') || newSyncJobId(existing.map((j) => j.id))
    const job = cleanSyncJob({ ...(draft as object), id })
    if (!job) return null
    const at = existing.findIndex((j) => j.id === id)
    if (at >= 0) existing[at] = job
    else existing.push(job)
    writeJobs(existing)
    return job
  }

  const removeJob = (id: string): boolean => {
    const existing = listJobs()
    const next = existing.filter((j) => j.id !== id)
    if (next.length === existing.length) return false
    writeJobs(next)
    return true
  }

  const dueAt = (job: SyncJob): number | null => nextDueAt(job, lastRun.get(job.id), Date.now())

  /** Turn a job's public enc config into the material the engine needs; never logs the secret. */
  const resolveEnc = async (e?: SyncEncryption): Promise<ResolvedEncryption | undefined> => {
    if (!e) return undefined
    const secret = getSyncSecret(e.secretId)
    if (!secret) throw new Error('the encryption secret is missing; set the passphrase or key again')
    if (e.mode === 'passphrase') return { mode: 'passphrase', passphrase: secret }
    const recipient = e.recipient || (await recipientOf(secret))
    return { mode: 'keypair', identity: secret, recipient }
  }

  const resolvedEnc = async (opts: CompareOptions): Promise<{ left?: ResolvedEncryption; right?: ResolvedEncryption }> => ({
    left: await resolveEnc(opts.enc?.left),
    right: await resolveEnc(opts.enc?.right)
  })

  const isEncrypted = (opts: CompareOptions): boolean => Boolean(opts.enc?.left || opts.enc?.right)
  const effectiveCompareBy = (opts: CompareOptions): SyncCompareBy => (isEncrypted(opts) ? 'hash' : opts.compareBy)

  type VersionState = { repo: string; password: string; keep: number; dest: string }

  /** Resolve the repo/password for a one-way local destination; throws before any file is touched. */
  const versionState = async (opts: RunOptions): Promise<VersionState | null> => {
    if (!opts.versions) return null
    if (opts.mode === 'both') throw new Error('version history is one-way only')
    const dest = opts.mode === 'rtl' ? opts.left : opts.right
    if (isRemotePath(dest)) throw new Error('version history needs a local destination')
    if (!(await resticAvailable())) throw new Error('restic is not installed')
    const password = getSyncSecret(opts.versions.secretId)
    if (!password) throw new Error('the restic repository password is missing')
    const repo = opts.versions.repo || path.join(dest, '.mfm-restic')
    if (!path.isAbsolute(repo) || isRemotePath(repo)) throw new Error('the restic repository must be a local absolute path')
    return { repo, password, keep: opts.versions.keep, dest }
  }

  /** The first run has no previous post-snapshot, so take one before touching the destination. */
  const preVersion = async (vs: VersionState | null): Promise<void> => {
    if (!vs) return
    const existing = await resticSnapshots(vs.repo, vs.password).catch((e) => {
      throw e instanceof Error ? e : new Error(String(e))
    })
    if (!existing.length) await resticBackup(vs.repo, vs.password, vs.dest)
  }

  const postVersion = async (vs: VersionState | null, summary: SyncRunSummary): Promise<void> => {
    if (!vs) return
    try {
      await resticBackup(vs.repo, vs.password, vs.dest)
      await resticForget(vs.repo, vs.password, vs.keep)
    } catch (e) {
      summary.errors.push(`versions: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ── compare / run ─────────────────────────────────────────────────────────────────────────
  const compare = async (opts: CompareOptions): Promise<CompareResult> => {
    const twoWay = opts.mode === 'both'
    const baseline: Baseline = twoWay ? loadBaseline(pairKey(opts.left, opts.right)) : {}
    const enc = await resolvedEnc(opts)
    return compareTrees(opts.left, opts.right, ops(), {
      compareBy: effectiveCompareBy(opts),
      ignore: opts.ignore ?? [],
      twoWay,
      baseline,
      enc,
      ctl: active?.control
    })
  }

  /** The rsync request is one-way and local; the same validation is used by the preview and the run. */
  const rsyncRequest = async (opts: RunOptions): Promise<RsyncRequest> => {
    if (opts.enc?.left || opts.enc?.right) throw new Error('rsync cannot encrypt; use the native engine')
    if (opts.mode === 'both') throw new Error('rsync works one way only')
    if (isRemotePath(opts.left) || isRemotePath(opts.right)) throw new Error('rsync is local only')
    if (!(await rsyncAvailable())) throw new Error('rsync is not installed')
    const src = opts.mode === 'rtl' ? opts.right : opts.left
    const dst = opts.mode === 'rtl' ? opts.left : opts.right
    return {
      src,
      dst,
      mode: opts.mode,
      deleteExtra: opts.deleteExtra === true,
      ignore: opts.ignore ?? [],
      compareBy: opts.compareBy,
      options: cleanRsyncOptions(opts.rsync),
      backupDir: opts.deleteExtra ? trashDirFor(dst) : undefined
    }
  }

  /** Compare and plan without touching a byte; the UI's «Compare» and «Dry run» both use this. */
  const plan = async (
    opts: RunOptions
  ): Promise<{ cmp: CompareResult; plan: SyncPlan; rows: SyncRow[]; blocked: boolean }> => {
    if (opts.useRsync) {
      const req = await rsyncRequest(opts)
      const r = await planRsync(req)
      return {
        cmp: { rows: r.rows, leftCount: r.rows.length, rightCount: r.rows.length, capped: r.capped, hashed: 0 },
        plan: r.plan,
        rows: r.rows,
        blocked: r.plan.conflicts.length > 0
      }
    }
    const cmp = await compare(opts)
    const planned = planRows(cmp.rows, opts.mode, {
      deleteExtra: opts.deleteExtra,
      selected: opts.selected ? new Set(opts.selected) : undefined,
      resolutions: opts.resolutions
    })
    return { cmp, plan: planned, rows: cmp.rows, blocked: planned.conflicts.length > 0 }
  }

  /** The rsync branch of a run: rsync's own dry run is the plan, and rsync does the work. */
  const runRsyncJob = async (opts: RunOptions): Promise<RunResult> => {
    if (active) throw new Error('a sync run is already in progress')
    if (opts.left === opts.right) throw new Error('the two folders are the same')
    const id = newId('sync')
    const control: SyncControl = { cancelled: false, paused: false }
    const started = Date.now()
    const summary: SyncRunSummary = {
      id,
      jobId: opts.jobId,
      left: opts.left,
      right: opts.right,
      mode: opts.mode,
      compareBy: effectiveCompareBy(opts),
      state: 'running',
      startedAt: started,
      copied: 0,
      removed: 0,
      skipped: 0,
      bytes: 0,
      conflicts: 0,
      errors: []
    }
    const progress: SyncProgress = {
      id,
      jobId: opts.jobId,
      state: 'running',
      done: 0,
      total: 0,
      files: 0,
      filesDone: 0,
      bytes: 0,
      bytesDone: 0,
      current: '',
      errors: [],
      paused: false
    }
    active = { id, control, paused: false, progress }
    let lastEmit = 0
    const emitProgress = (force = false): void => {
      const now = Date.now()
      if (!force && now - lastEmit < progressEvery) return
      lastEmit = now
      deps.emit('sync:progress', { ...progress, paused: control.paused })
    }
    try {
      const req = await rsyncRequest(opts)
      const planned = await planRsync(req)
      summary.conflicts = 0
      progress.total = planned.plan.copy.length + planned.plan.remove.length
      progress.files = progress.total
      const blocked = false
      if (opts.dryRun) {
        summary.state = 'done'
        summary.finishedAt = Date.now()
        summary.skipped = planned.plan.skipped
        active = null
        deps.emit('sync:done', summary)
        return { id, rows: planned.rows, plan: planned.plan, cmp: { rows: planned.rows, leftCount: planned.rows.length, rightCount: planned.rows.length, capped: planned.capped, hashed: 0 }, applied: null, summary, blocked }
      }
      const vs = await versionState(opts)
      await preVersion(vs)
      emitProgress(true)
      const applied = await applyRsync(
        req,
        control,
        (rel) => {
          progress.current = rel
          progress.filesDone++
          progress.done = progress.filesDone
          emitProgress()
        },
        (delta) => {
          progress.bytesDone += delta
          progress.bytes = progress.bytesDone
          emitProgress()
        }
      )
      summary.copied = applied.copied
      summary.removed = applied.removed
      summary.bytes = applied.bytes
      summary.errors = applied.errors
      summary.state = applied.cancel ? 'cancelled' : applied.errors.length ? 'error' : 'done'
      summary.finishedAt = Date.now()
      progress.state = summary.state
      progress.errors = applied.errors
      deps.emit('sync:progress', { ...progress, paused: control.paused })
      if (summary.state === 'done') await postVersion(vs, summary)
      saveRun(summary, planned.plan)
      pruneRuns()
      if (opts.jobId) lastRun.set(opts.jobId, started)
      deps.emit('sync:done', summary)
      return {
        id,
        rows: planned.rows,
        plan: planned.plan,
        cmp: { rows: planned.rows, leftCount: planned.rows.length, rightCount: planned.rows.length, capped: planned.capped, hashed: 0 },
        applied,
        summary,
        blocked
      }
    } catch (e) {
      summary.state = control.cancelled ? 'cancelled' : 'error'
      summary.finishedAt = Date.now()
      summary.errors = [e instanceof Error ? e.message : String(e)]
      saveRun(summary, { mode: opts.mode, copy: [], remove: [], conflicts: [], skipped: 0 })
      deps.emit('sync:done', summary)
      throw e
    } finally {
      if (active?.id === id) active = null
    }
  }

  const run = async (opts: RunOptions): Promise<RunResult> => {
    if (opts.useRsync) return runRsyncJob(opts)
    if (active) throw new Error('a sync run is already in progress')
    if (opts.left === opts.right) throw new Error('the two folders are the same')
    const id = newId('sync')
    const control: SyncControl = { cancelled: false, paused: false }
    active = { id, control, paused: false }
    const started = Date.now()
    const summary: SyncRunSummary = {
      id,
      jobId: opts.jobId,
      left: opts.left,
      right: opts.right,
      mode: opts.mode,
      compareBy: opts.compareBy,
      state: 'running',
      startedAt: started,
      copied: 0,
      removed: 0,
      skipped: 0,
      bytes: 0,
      conflicts: 0,
      errors: []
    }
    const progress: SyncProgress = {
      id,
      jobId: opts.jobId,
      state: 'running',
      done: 0,
      total: 0,
      files: 0,
      filesDone: 0,
      bytes: 0,
      bytesDone: 0,
      current: '',
      errors: [],
      paused: false
    }
    active = { id, control, paused: false, progress }
    let lastEmit = 0
    const emitProgress = (force = false): void => {
      const now = Date.now()
      if (!force && now - lastEmit < progressEvery) return
      lastEmit = now
      deps.emit('sync:progress', { ...progress, paused: control.paused })
    }
    control.onFile = (rel) => {
      progress.current = rel
      progress.filesDone++
      progress.done = progress.filesDone
      emitProgress()
    }
    control.onBytes = (n) => {
      progress.bytesDone += n
      progress.bytes = progress.bytesDone
      emitProgress()
    }
    try {
      const cmp = await compare(opts)
      const plan = planRows(cmp.rows, opts.mode, {
        deleteExtra: opts.deleteExtra,
        selected: opts.selected ? new Set(opts.selected) : undefined,
        resolutions: opts.resolutions
      })
      const blocked = plan.conflicts.length > 0
      summary.conflicts = plan.conflicts.length
      progress.total = plan.copy.length + plan.remove.length
      progress.files = progress.total
      opts.onPlan?.(cmp.rows, plan, cmp)
      if (opts.dryRun || blocked) {
        summary.state = opts.dryRun ? 'done' : 'error'
        summary.finishedAt = Date.now()
        summary.skipped = plan.skipped
        if (blocked) summary.errors = ['conflicts need a decision']
        if (!opts.dryRun) {
          // a blocked plan is a real result worth remembering, but nothing was written
          saveRun(summary, plan)
          pruneRuns()
        }
        active = null
        deps.emit('sync:done', summary)
        return { id, rows: cmp.rows, plan, cmp, applied: null, summary, blocked }
      }
      const remoteDeletes = plan.remove.filter((a) =>
        isRemotePath(a.from === 'left' ? opts.left : opts.right)
      )
      if (remoteDeletes.length && !opts.confirmRemoteDelete) {
        throw new Error('refusing to delete on a remote side without an explicit confirmation')
      }
      // the history is taken before the first file is touched; a missing secret/repo aborts here
      const vs = await versionState(opts)
      await preVersion(vs)
      emitProgress(true)
      const applied = await applyPlan(opts.left, opts.right, plan, ops(), {
        trash: deps.trash,
        ctl: control,
        enc: await resolvedEnc(opts)
      })
      summary.copied = applied.copied
      summary.removed = applied.removed
      summary.skipped = applied.skipped
      summary.bytes = applied.bytes
      summary.errors = applied.errors
      summary.state = applied.cancel ? 'cancelled' : applied.errors.length ? 'error' : 'done'
      summary.finishedAt = Date.now()
      progress.state = summary.state
      progress.errors = applied.errors
      deps.emit('sync:progress', { ...progress })
      if (summary.state === 'done') await postVersion(vs, summary)
      saveRun(summary, plan)
      pruneRuns()
      if (opts.mode === 'both' && summary.state === 'done') {
        const pair = pairKey(opts.left, opts.right)
        const previous = loadBaseline(pair)
        saveBaseline(pair, nextBaseline(cmp.rows, previous, plan))
      }
      if (opts.jobId) lastRun.set(opts.jobId, started)
      deps.emit('sync:done', summary)
      return { id, rows: cmp.rows, plan, cmp, applied, summary, blocked }
    } catch (e) {
      summary.state = control.cancelled ? 'cancelled' : 'error'
      summary.finishedAt = Date.now()
      summary.errors = [e instanceof Error ? e.message : String(e)]
      saveRun(summary, { mode: opts.mode, copy: [], remove: [], conflicts: [], skipped: 0 })
      deps.emit('sync:done', summary)
      throw e
    } finally {
      if (active?.id === id) active = null
    }
  }

  const cancel = (id?: string): boolean => {
    if (!active || (id && active.id !== id)) return false
    active.control.cancelled = true
    active.control.paused = false
    return true
  }

  const pause = (id?: string): boolean => {
    if (!active || (id && active.id !== id)) return false
    active.control.paused = true
    active.paused = true
    if (active.progress) deps.emit('sync:progress', { ...active.progress, paused: true })
    return true
  }

  const resume = (id?: string): boolean => {
    if (!active || (id && active.id !== id)) return false
    active.control.paused = false
    active.paused = false
    if (active.progress) deps.emit('sync:progress', { ...active.progress, paused: false })
    return true
  }

  const status = (): { id: string; state: string; paused: boolean } | null =>
    active ? { id: active.id, state: 'running', paused: active.paused } : null

  // ── history / restore ─────────────────────────────────────────────────────────────────────
  const history = (limit = 100): SyncRunSummary[] => listRuns(limit)

  const restore = async (runId: string, confirmRemoteDelete = false): Promise<RunResult> => {
    const found = getRun(runId)
    if (!found?.plan) throw new Error('the run was not found')
    if (active) throw new Error('a sync run is already in progress')
    const inv = invertPlan(found.plan)
    const summary: SyncRunSummary = {
      id: newId('sync'),
      jobId: found.summary.jobId,
      left: found.summary.left,
      right: found.summary.right,
      mode: 'ltr',
      compareBy: found.summary.compareBy,
      state: 'running',
      startedAt: Date.now(),
      copied: 0,
      removed: 0,
      skipped: 0,
      bytes: 0,
      conflicts: 0,
      errors: [...inv.unrestorable.map((rel) => `${rel}: deleted in the original run, no stored copy`)],
    }
    const badRemote = inv.copy.filter((a) => isRemotePath(a.from === 'left' ? summary.left : summary.right))
    if (badRemote.length && !confirmRemoteDelete) {
      throw new Error('refusing to write on a remote side without an explicit confirmation')
    }
    const plan: SyncPlan = { mode: 'ltr', copy: inv.copy, remove: [], conflicts: [], skipped: 0 }
    const control: SyncControl = { cancelled: false, paused: false }
    active = { id: summary.id, control, paused: false }
    try {
      const applied = await applyPlan(summary.left, summary.right, plan, ops(), { trash: deps.trash, ctl: control })
      summary.copied = applied.copied
      summary.skipped = applied.skipped
      summary.bytes = applied.bytes
      summary.errors.push(...applied.errors)
      summary.state = applied.errors.length ? 'error' : 'done'
      summary.finishedAt = Date.now()
      saveRun(summary, plan)
      pruneRuns()
      deps.emit('sync:done', summary)
      return {
        id: summary.id,
        rows: [],
        plan,
        cmp: { rows: [], leftCount: 0, rightCount: 0, capped: false, hashed: 0 },
        applied,
        summary,
        blocked: false
      }
    } finally {
      if (active?.id === summary.id) active = null
    }
  }

  // ── scheduler ─────────────────────────────────────────────────────────────────────────────
  const canWatch = (p: string): boolean => !isRemotePath(p)

  const syncWatchers = (): void => {
    const wanted = new Map<string, SyncJob>()
    for (const job of listJobs()) if (job.enabled && job.schedule.onChange) wanted.set(job.id, job)
    for (const [id, entry] of watchers) {
      if (!wanted.has(id)) {
        entry.close()
        if (entry.timer) clearTimeout(entry.timer)
        watchers.delete(id)
      }
    }
    for (const [id, job] of wanted) {
      if (watchers.has(id)) continue
      const roots = [job.left, job.right].filter(canWatch)
      if (!roots.length) continue
      const handlers: { close(): void }[] = []
      const fire = (): void => {
        const old = changeTimers.get(id)
        if (old) clearTimeout(old)
        changeTimers.set(
          id,
          setTimeout(() => {
            changeTimers.delete(id)
            void runJob(id, undefined, true).catch(() => undefined)
          }, 10_000)
        )
      }
      for (const root of roots) {
        try {
          const w = fsWatch(root, { recursive: true }, fire)
          w.on('error', () => undefined)
          handlers.push(w)
        } catch {
          // recursive watching is not available on every filesystem; the clock schedule still works
        }
      }
      if (!handlers.length) continue
      watchers.set(id, {
        close: () => handlers.forEach((h) => h.close()),
        timer: null
      })
    }
  }

  const runJob = async (id: string, mode?: SyncMode, scheduled = false): Promise<RunResult | null> => {
    const job = listJobs().find((j) => j.id === id)
    if (!job) return null
    return run({
      jobId: job.id,
      left: job.left,
      right: job.right,
      mode: mode ?? job.direction,
      compareBy: job.compareBy,
      ignore: job.ignore,
      deleteExtra: job.deleteExtra,
      useRsync: job.useRsync === true,
      rsync: job.rsync,
      enc: { left: job.encLeft, right: job.encRight },
      // a scheduled run on a remote side still needs a human; skipping is safer than guessing
      confirmRemoteDelete: !scheduled
    })
  }

  const tick = async (): Promise<void> => {
    if (tickBusy || active) return
    tickBusy = true
    try {
      // a job saved after boot may have gained/lost onChange while the app was running
      syncWatchers()
      const now = Date.now()
      const jobs = listJobs().filter((j) => j.enabled)
      for (const job of jobs) {
        if (job.schedule.onStart && !startedJobs.has(job.id)) {
          startedJobs.add(job.id)
          await runJob(job.id, job.direction, true).catch(() => undefined)
          continue
        }
        if (isDue(job, lastRun.get(job.id), now)) {
          lastRun.set(job.id, now)
          await runJob(job.id, job.direction, true).catch(() => undefined)
        }
      }
    } finally {
      tickBusy = false
    }
  }

  const startScheduler = (): void => {
    if (timer) return
    try {
      for (const run of listRuns(300)) if (run.jobId) lastRun.set(run.jobId, Math.max(lastRun.get(run.jobId) ?? 0, run.startedAt))
    } catch {
      // a broken history must not stop the scheduler
    }
    syncWatchers()
    void tick()
    timer = setInterval(() => void tick(), 30_000)
    timer.unref?.()
  }

  const stopScheduler = (): void => {
    if (timer) clearInterval(timer)
    timer = null
    for (const entry of watchers.values()) {
      entry.close()
      if (entry.timer) clearTimeout(entry.timer)
    }
    watchers.clear()
    for (const t of changeTimers.values()) clearTimeout(t)
    changeTimers.clear()
  }

  /** Called after a drive was mounted by the app; event-driven, not a poll. */
  const notifyMount = async (): Promise<void> => {
    if (active) return
    for (const job of listJobs()) {
      if (!job.enabled || !job.schedule.onMount) continue
      await runJob(job.id, job.direction, true).catch(() => undefined)
    }
  }

  const notifyChange = (path: string): void => {
    for (const job of listJobs()) {
      if (!job.enabled || !job.schedule.onChange) continue
      const roots = [job.left, job.right].filter(canWatch)
      if (!roots.some((r) => path === r || path.startsWith(r.replace(/\/+$/, '') + '/'))) continue
      const old = changeTimers.get(job.id)
      if (old) clearTimeout(old)
      changeTimers.set(
        job.id,
        setTimeout(() => {
          changeTimers.delete(job.id)
          void runJob(job.id, job.direction, true).catch(() => undefined)
        }, 10_000)
      )
    }
  }

  const baseline = (left: string, right: string): Baseline => loadBaseline(pairKey(left, right))

  /** Snapshot list for the Versions tab; the repo defaults to the destination's .mfm-restic. */
  const versionsQuery = async (opts: {
    left: string
    right: string
    mode: SyncMode
    repo?: string
    secretId: string
  }): Promise<{ available: boolean; repo: string; snapshots: SyncSnapshot[]; error: string }> => {
    if (!(await resticAvailable())) {
      return { available: false, repo: '', snapshots: [], error: 'restic is not installed' }
    }
    if (opts.mode === 'both') throw new Error('version history is one-way only')
    const dest = opts.mode === 'rtl' ? opts.left : opts.right
    if (isRemotePath(dest)) throw new Error('version history needs a local destination')
    const password = getSyncSecret(opts.secretId)
    if (!password) throw new Error('the restic repository password is missing')
    const repo = opts.repo || path.join(dest, '.mfm-restic')
    if (!path.isAbsolute(repo) || isRemotePath(repo)) throw new Error('the restic repository must be a local absolute path')
    const list = await resticSnapshots(repo, password)
    return { available: true, repo, snapshots: list, error: '' }
  }

  /** Restore a snapshot into a fresh temp folder; the caller opens that folder for inspection. */
  const versionsRestore = async (repo: string, secretId: string, id: string): Promise<string> => {
    if (!path.isAbsolute(repo) || isRemotePath(repo)) throw new Error('the restic repository must be a local absolute path')
    const password = getSyncSecret(secretId)
    if (!password) throw new Error('the restic repository password is missing')
    return resticRestore(repo, password, id)
  }

  return {
    setRemote,
    listJobs,
    writeJobs,
    upsertJob,
    removeJob,
    compare,
    plan,
    run,
    cancel,
    pause,
    resume,
    status,
    history,
    restore,
    baseline,
    versionsQuery,
    versionsRestore,
    dueAt,
    runJob,
    notifyMount,
    notifyChange,
    startScheduler,
    stopScheduler,
    /** exposed for a «forget the last run» button */
    clearBaseline: (left: string, right: string): void => {
      clearStoredBaseline(pairKey(left, right))
    }
  }
}

export type SyncService = ReturnType<typeof createSyncService>
