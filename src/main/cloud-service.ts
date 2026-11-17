/**
 * Cloud folders as a thin layer over the existing sync engine.
 *
 * Nothing here re-implements a file operation: `compareTrees` builds the rows, `planRows` decides,
 * `applyPlan` copies/deletes through `PathOps`, and the baseline lives in `sync_baseline`. This
 * service only owns the account/binding lifecycle, the single scheduler, the local watcher and the
 * live state the UI draws.
 */
import { promises as fs, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { RemoteFs } from './remote-core.ts'
import type { SyncControl } from './sync-engine.ts'
import { applyPlan, compareTrees, createOps } from './sync-engine.ts'
import { makePlan } from './sync-engine.ts'
import { nextBaseline } from './sync-core.ts'
import { conflictPaths, entryState, nextRunAt } from './cloud-core.ts'
import { cloudOps } from './cloud-engine.ts'
import { createDav, davAccountLabel, nextcloudRoot, type DavClient } from './cloud-dav.ts'
import {
  cloudBindings,
  cloudAccounts,
  deleteAccount,
  deleteBinding,
  findAccount,
  findBinding,
  getSecret,
  patchRuntime,
  putAccount,
  putBinding,
  runtimeOf,
  setSecret,
  wipeCloud
} from './cloud-store.ts'
import {
  cleanCloudBinding,
  cleanCloudInterval,
  cleanCloudUrl,
  cloudPath,
  cloudProvider,
  isAbsoluteFolder,
  isCloudPath,
  newCloudId,
  overlaps,
  type CloudAccount,
  type CloudBinding,
  type CloudBindingStatus,
  type CloudEntryState,
  type CloudPreview,
  type CloudState,
  type CloudTarget,
  type CloudView
} from '../shared/cloud.ts'
import { cleanRemoteName } from './cloud-core.ts'
import { loadBaseline, saveBaseline } from './sync-store.ts'
import { pairKey } from '../shared/sync.ts'

export type CloudDeps = {
  remote?: RemoteFs
  trash(p: string): Promise<void>
  emit(channel: string, payload: unknown): void
}

type Live = {
  state: CloudState
  lastRunAt: number | null
  nextRunAt: number | null
  lastError: string | null
  conflicts: string[]
  dirty: boolean
  failures: number
}

export type CloudAccountDraft = {
  provider: string
  url?: string
  user?: string
  password?: string
  label?: string
}

export type CloudBindingDraft = {
  id?: string
  accountId: string
  localPath: string
  remoteId: string
  remoteLabel?: string
  name?: string
  compareBy?: string
  deleteExtra?: boolean
  intervalMs?: number
  direction?: string
}

export type CloudBindingPatch = {
  name?: string
  intervalMs?: number
  deleteExtra?: boolean
  compareBy?: string
  direction?: string
  enabled?: boolean
  paused?: boolean
}

export type CloudPreviewDraft = {
  accountId: string
  localPath: string
  remoteId: string
}

const TICK_MS = 30_000
const DEBOUNCE_MS = 1_500

const liveOf = (id: string): Live => {
  const stored = runtimeOf(id)
  return {
    state: stored.conflicts.length ? 'conflict' : 'idle',
    lastRunAt: stored.lastRunAt,
    nextRunAt: null,
    lastError: stored.lastError,
    conflicts: stored.conflicts,
    dirty: stored.dirty,
    failures: stored.failures
  }
}

export function createCloudService(deps: CloudDeps) {
  const live = new Map<string, Live>()
  const running = new Set<string>()
  const watchers = new Map<string, FSWatcher>()
  const debounces = new Map<string, NodeJS.Timeout>()
  let timer: NodeJS.Timeout | null = null

  const status = (id: string): CloudBindingStatus => {
    const l = live.get(id) ?? liveOf(id)
    return {
      bindingId: id,
      state: l.state,
      lastRunAt: l.lastRunAt,
      nextRunAt: l.nextRunAt,
      lastError: l.lastError,
      conflicts: l.conflicts,
      dirty: l.dirty
    }
  }

  const view = (): CloudView => {
    const bindings = cloudBindings()
    return {
      accounts: cloudAccounts(),
      bindings,
      status: bindings.map((b) => status(b.id)),
      busy: running.size > 0
    }
  }

  const broadcast = (): void => deps.emit('cloud:state', view())

  const setLive = (id: string, patch: Partial<Live>): Live => {
    const next = { ...(live.get(id) ?? liveOf(id)), ...patch }
    live.set(id, next)
    return next
  }

  /** Persist the small part that must survive a restart (not the live clock). */
  const persist = (id: string): void => {
    const l = live.get(id) ?? liveOf(id)
    patchRuntime(id, {
      lastRunAt: l.lastRunAt,
      lastError: l.lastError,
      conflicts: l.conflicts,
      failures: l.failures,
      dirty: l.dirty
    })
  }

  const davFor = (account: CloudAccount): DavClient => {
    const secret = getSecret(account.id)
    if (!secret) throw new Error('the stored password is not available; reconnect this account')
    if (!account.url) throw new Error('this account has no server address')
    return createDav({ base: account.url, user: account.user ?? '', pass: secret })
  }

  const bindingsFor = (accountId: string): CloudBinding[] => cloudBindings().filter((b) => b.accountId === accountId)

  // ---------------------------------------------------------------- accounts

  async function saveAccount(draft: CloudAccountDraft): Promise<CloudAccount> {
    const provider = cloudProvider(String(draft.provider ?? ''))
    if (!provider) throw new Error('unknown provider')
    if (!provider.ready) throw new Error('this provider is not available yet')
    if (provider.family !== 'dav') throw new Error('this provider is not available yet')
    const user = String(draft.user ?? '').trim()
    if (!user) throw new Error('a user name is required')
    const password = String(draft.password ?? '')
    if (!password) throw new Error(' an app password is required')
    const base = cleanCloudUrl(draft.url)
    if (!base) throw new Error('a valid http(s) URL is required')
    const url = provider.id === 'nextcloud' || provider.id === 'owncloud' ? nextcloudRoot(base, user) : base.replace(/\/+$/, '')
    const dav = createDav({ base: url, user, pass: password })
    await dav.test()
    // the id is only minted once the connection is proven, so a failed attempt leaves nothing behind
    const id = newCloudId([...cloudAccounts().map((a) => a.id), ...cloudBindings().map((b) => b.accountId)])
    const { sessionOnly } = setSecret(id, password)
    const account: CloudAccount = {
      id,
      provider: provider.id,
      label: String(draft.label ?? '').trim().slice(0, 120) || davAccountLabel(url, user),
      url,
      user,
      sessionOnly,
      createdAt: Date.now()
    }
    putAccount(account)
    setLive(account.id, { ...liveOf(account.id), state: 'idle', lastError: null })
    broadcast()
    return account
  }

  function removeAccount(id: string): void {
    for (const b of bindingsFor(id)) stopBinding(b.id)
    deleteAccount(id)
    live.delete(id)
    broadcast()
  }

  function accountById(id: string): CloudAccount {
    const a = findAccount(String(id ?? ''))
    if (!a) throw new Error('unknown account')
    return a
  }

  // ---------------------------------------------------------------- browsing

  async function browse(accountId: string, remotePath = '/'): Promise<CloudTarget[]> {
    const account = accountById(accountId)
    const dav = davFor(account)
    const p = remotePath.startsWith('/') ? remotePath.replace(/\/+$/, '') || '/' : `/${remotePath}`
    const rows = await dav.list(p)
    return rows
      .filter((r) => r.dir)
      .map((r) => ({ path: r.path, name: r.name, dir: true, size: 0, mtime: r.mtime }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async function createFolder(accountId: string, parent: string, name: string): Promise<string> {
    const account = accountById(accountId)
    const clean = cleanRemoteName(name)
    if (!clean) throw new Error('a folder name is required')
    const dav = davFor(account)
    return dav.createFolder(parent.startsWith('/') ? parent : `/${parent}`, clean)
  }

  /**
   * The estimate the dialog shows before a binding exists. It compares by mtime on purpose: a
   * content hash would download every file just to draw three numbers. The real binding still uses
   * the provider's own mode, and the payload says so.
   */
  async function preview(draft: CloudPreviewDraft): Promise<CloudPreview> {
    const account = accountById(draft.accountId)
    const localPath = String(draft.localPath ?? '').trim()
    if (!isAbsoluteFolder(localPath)) throw new Error('an absolute local folder is required')
    const st = await fs.stat(localPath).catch(() => null)
    if (!st || !st.isDirectory()) throw new Error('the local folder does not exist')
    const remoteId = String(draft.remoteId ?? '/').trim()
    if (!remoteId.startsWith('/')) throw new Error('a remote folder is required')
    const dav = davFor(account)
    const remoteStat = await dav.stat(remoteId)
    if (!remoteStat || !remoteStat.dir) throw new Error('the remote folder does not exist')
    const provider = cloudProvider(account.provider)
    const hashMode = provider?.preservesMtime === false
    const probe: CloudBinding = {
      id: 'cloud-preview01',
      accountId: account.id,
      name: 'preview',
      localPath,
      remoteId,
      remoteLabel: remoteId,
      direction: 'both',
      compareBy: 'mtime',
      deleteExtra: false,
      intervalMs: 900_000,
      enabled: true,
      paused: true,
      createdAt: 0
    }
    const ops = createOps(deps.remote, cloudOps(probe, dav))
    const ctl: SyncControl = { cancelled: false, paused: false }
    const cmp = await compareTrees(localPath, cloudPath(probe.id), ops, {
      compareBy: 'mtime',
      twoWay: true,
      maxRows: 5_000,
      budgetMs: 15_000,
      ctl
    })
    const out: CloudPreview = {
      up: 0,
      down: 0,
      same: 0,
      conflicts: 0,
      bytesUp: 0,
      bytesDown: 0,
      capped: cmp.capped,
      hashMode
    }
    for (const row of cmp.rows) {
      if (row.state === 'leftOnly' || row.state === 'leftNewer') {
        out.up++
        out.bytesUp += row.left?.size ?? 0
      } else if (row.state === 'rightOnly' || row.state === 'rightNewer') {
        out.down++
        out.bytesDown += row.right?.size ?? 0
      } else if (row.state === 'conflict' || row.state === 'typeDiff') {
        out.conflicts++
      } else {
        out.same++
      }
    }
    return out
  }

  // ---------------------------------------------------------------- bindings

  async function saveBinding(draft: CloudBindingDraft): Promise<CloudBinding> {
    const account = accountById(draft.accountId)
    if (account.provider !== 'nextcloud' && account.provider !== 'owncloud' && account.provider !== 'webdav' && account.provider !== 'qsync') {
      throw new Error('this provider is not available yet')
    }
    const localPath = String(draft.localPath ?? '').trim()
    if (!isAbsoluteFolder(localPath)) throw new Error('an absolute local folder is required')
    const st = await fs.stat(localPath).catch(() => null)
    if (!st || !st.isDirectory()) throw new Error('the local folder does not exist')
    const remoteId = String(draft.remoteId ?? '/').trim()
    if (!remoteId.startsWith('/')) throw new Error('a remote folder is required')
    const dav = davFor(account)
    const remoteStat = await dav.stat(remoteId)
    if (!remoteStat || !remoteStat.dir) throw new Error('the remote folder does not exist')
    const others = cloudBindings().filter((b) => b.id !== draft.id)
    if (others.some((b) => overlaps(b.localPath, localPath))) throw new Error('this folder is already used by another cloud binding')
    const existing = draft.id ? findBinding(String(draft.id)) : null
    const provider = cloudProvider(account.provider)
    // a server that does not keep the timestamp would bounce every upload, so it compares by hash
    const compareBy = draft.compareBy === 'mtime' || draft.compareBy === 'hash'
      ? draft.compareBy
      : provider?.preservesMtime === false
        ? 'hash'
        : 'mtime'
    const binding = cleanCloudBinding({
      id: existing?.id ?? newCloudId([...cloudBindings().map((b) => b.id), ...cloudAccounts().map((a) => a.id)]),
      accountId: account.id,
      name: draft.name || path.basename(localPath),
      localPath,
      remoteId,
      remoteLabel: draft.remoteLabel || remoteId,
      direction: draft.direction ?? 'both',
      compareBy,
      deleteExtra: draft.deleteExtra === true,
      intervalMs: cleanCloudInterval(provider?.id ?? 'webdav', draft.intervalMs),
      enabled: true,
      paused: false,
      createdAt: existing?.createdAt ?? Date.now()
    })
    if (!binding) throw new Error('invalid cloud folder')
    // the binding keeps the account's provider floor
    binding.intervalMs = cleanCloudInterval(account.provider, binding.intervalMs)
    putBinding(binding)
    if (existing) stopBinding(existing.id)
    const prev = runtimeOf(binding.id)
    setLive(binding.id, {
      state: prev.conflicts.length ? 'conflict' : 'idle',
      lastRunAt: prev.lastRunAt,
      nextRunAt: Date.now(),
      lastError: prev.lastError,
      conflicts: prev.conflicts,
      dirty: true,
      failures: 0
    })
    startWatcher(binding)
    broadcast()
    return binding
  }

  function updateBinding(id: string, patch: CloudBindingPatch): CloudBinding {
    const cur = findBinding(String(id ?? ''))
    if (!cur) throw new Error('unknown cloud folder')
    const account = findAccount(cur.accountId)
    const next: CloudBinding = {
      ...cur,
      name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim().slice(0, 120) : cur.name,
      intervalMs:
        patch.intervalMs === undefined
          ? cur.intervalMs
          : cleanCloudInterval(account?.provider ?? 'webdav', patch.intervalMs),
      deleteExtra: patch.deleteExtra === undefined ? cur.deleteExtra : patch.deleteExtra === true,
      compareBy: patch.compareBy === 'mtime' ? 'mtime' : patch.compareBy === 'hash' ? 'hash' : cur.compareBy,
      direction: patch.direction === 'ltr' || patch.direction === 'rtl' ? patch.direction : patch.direction === 'both' ? 'both' : cur.direction,
      enabled: patch.enabled === undefined ? cur.enabled : patch.enabled !== false,
      paused: patch.paused === undefined ? cur.paused : patch.paused === true
    }
    putBinding(next)
    startWatcher(next)
    const l = setLive(next.id, {
      state: next.paused ? 'paused' : (live.get(next.id)?.state ?? 'idle'),
      nextRunAt: next.paused ? null : Date.now()
    })
    persist(next.id)
    if (l.state === 'paused') broadcast()
    else schedule(next.id)
    broadcast()
    return next
  }

  function removeBinding(id: string): void {
    stopBinding(String(id ?? ''))
    deleteBinding(String(id ?? ''))
    live.delete(String(id ?? ''))
    broadcast()
  }

  function stopBinding(id: string): void {
    const w = watchers.get(id)
    if (w) {
      try {
        w.close()
      } catch {
        // already gone
      }
      watchers.delete(id)
    }
    const d = debounces.get(id)
    if (d) clearTimeout(d)
    debounces.delete(id)
  }

  /** A recursive watch on the local folder; a change pulls the next run forward. */
  function startWatcher(binding: CloudBinding): void {
    if (watchers.has(binding.id)) return
    try {
      const w = watch(binding.localPath, { recursive: true }, () => {
        const l = live.get(binding.id)
        if (l?.state === 'paused') return
        // a run writes into this folder; those events must not schedule another run
        if (running.has(binding.id)) return
        setLive(binding.id, { dirty: true })
        const prev = debounces.get(binding.id)
        if (prev) clearTimeout(prev)
        debounces.set(
          binding.id,
          setTimeout(() => {
            debounces.delete(binding.id)
            persist(binding.id)
            schedule(binding.id, true)
          }, DEBOUNCE_MS)
        )
      })
      w.on('error', () => undefined)
      watchers.set(binding.id, w)
    } catch {
      // some network mounts have no watcher; the interval still catches up
    }
  }

  // ---------------------------------------------------------------- running

  function schedule(id: string, soon = false): void {
    const binding = findBinding(id)
    if (!binding) return
    const l = live.get(id) ?? liveOf(id)
    const next = soon
      ? Date.now() + 500
      : nextRunAt(binding, { lastRunAt: l.lastRunAt, dirty: l.dirty }, Date.now(), l.failures)
    setLive(id, { nextRunAt: next })
  }

  const failState = (message: string): CloudState =>
    /EAI_AGAIN|ENOTFOUND|ECONNREFUSED|timeout|timed out|network|fetch failed/i.test(message) ? 'offline' : 'error'

  async function run(bindingId: string, opts: { confirmDelete?: boolean } = {}): Promise<{
    ok: boolean
    copied: number
    removed: number
    conflicts: number
    blockedDeletes: number
    error?: string
  }> {
    const id = String(bindingId ?? '')
    const binding = findBinding(id)
    if (!binding) return { ok: false, copied: 0, removed: 0, conflicts: 0, blockedDeletes: 0, error: 'unknown cloud folder' }
    if (running.has(id)) return { ok: false, copied: 0, removed: 0, conflicts: 0, blockedDeletes: 0, error: 'a run is already in flight' }
    const account = findAccount(binding.accountId)
    if (!account) return { ok: false, copied: 0, removed: 0, conflicts: 0, blockedDeletes: 0, error: 'the account is gone' }
    running.add(id)
    setLive(id, { state: 'checking', lastError: null })
    broadcast()
    const ctl: SyncControl = { cancelled: false, paused: false }
    try {
      const dav = davFor(account)
      const ops = createOps(deps.remote, cloudOps(binding, dav))
      const root = cloudPath(binding.id)
      const pair = pairKey(binding.localPath, root)
      const baseline = loadBaseline(pair)
      setLive(id, { state: 'syncing' })
      broadcast()
      const cmp = await compareTrees(binding.localPath, root, ops, {
        compareBy: binding.compareBy,
        twoWay: binding.direction === 'both',
        baseline,
        maxRows: 20_000,
        budgetMs: 120_000,
        ctl,
        onProgress: (phase, done, current) =>
          deps.emit('cloud:progress', { bindingId: id, phase, done, current })
      })
      const conflicts = conflictPaths(cmp.rows)
      const plan = makePlan(cmp.rows, binding.direction, { deleteExtra: binding.deleteExtra })
      // a scheduled run never deletes on the remote side without a human saying so
      let blockedDeletes = 0
      if (!opts.confirmDelete) {
        const kept = plan.remove.filter((a) => a.to !== 'right')
        blockedDeletes = plan.remove.length - kept.length
        plan.remove = kept
      }
      const applied = await applyPlan(binding.localPath, root, plan, ops, { trash: deps.trash, ctl })
      const next = nextBaseline(cmp.rows, baseline, plan)
      saveBaseline(pair, next)
      const l = setLive(id, {
        state: conflicts.length ? 'conflict' : applied.errors.length ? 'error' : 'idle',
        lastRunAt: Date.now(),
        lastError: applied.errors[0] ?? null,
        conflicts,
        dirty: false,
        failures: applied.errors.length ? l0(id) + 1 : 0
      })
      l.nextRunAt = nextRunAt(binding, { lastRunAt: l.lastRunAt, dirty: false }, Date.now(), l.failures)
      persist(id)
      broadcast()
      return {
        ok: applied.errors.length === 0,
        copied: applied.copied,
        removed: applied.removed,
        conflicts: conflicts.length,
        blockedDeletes,
        ...(applied.errors.length ? { error: applied.errors.slice(0, 3).join('; ') } : {})
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const l = setLive(id, {
        state: failState(message),
        lastError: message.slice(0, 400),
        failures: l0(id) + 1,
        dirty: true
      })
      l.nextRunAt = nextRunAt({ intervalMs: binding.intervalMs, enabled: binding.enabled }, { lastRunAt: Date.now(), dirty: false }, Date.now(), l.failures)
      persist(id)
      broadcast()
      return { ok: false, copied: 0, removed: 0, conflicts: 0, blockedDeletes: 0, error: message }
    } finally {
      running.delete(id)
      broadcast()
    }
  }

  const l0 = (id: string): number => live.get(id)?.failures ?? runtimeOf(id).failures

  // ---------------------------------------------------------------- scheduler

  function tick(): void {
    const now = Date.now()
    for (const binding of cloudBindings()) {
      if (!binding.enabled || binding.paused) continue
      if (running.has(binding.id)) continue
      const l = live.get(binding.id) ?? liveOf(binding.id)
      if (!live.has(binding.id)) live.set(binding.id, l)
      if (l.nextRunAt === null) {
        schedule(binding.id)
        continue
      }
      if (now < l.nextRunAt) continue
      void run(binding.id).catch(() => undefined)
    }
  }

  function start(): void {
    if (timer) return
    for (const b of cloudBindings()) {
      if (!live.has(b.id)) live.set(b.id, liveOf(b.id))
      startWatcher(b)
      // a catch-up: everything that changed while the app was closed is applied on the first tick
      schedule(b.id, true)
    }
    timer = setInterval(tick, TICK_MS)
    setTimeout(tick, 1500)
  }

  function stop(): void {
    if (timer) clearInterval(timer)
    timer = null
    for (const id of [...watchers.keys()]) stopBinding(id)
    for (const d of debounces.values()) clearTimeout(d)
    debounces.clear()
  }

  /** Called after a successful account connection so the first run does not wait an interval. */
  function wake(id: string): void {
    if (findBinding(id)) schedule(id, true)
  }

  // ---------------------------------------------------------------- badges

  /**
   * The state a pane row should draw, or `null` when the path is not inside a binding.
   * Few bindings exist, so a prefix check is cheaper than maintaining a second index.
   */
  function forPath(p: string): { provider: string; state: CloudEntryState; root: boolean } | null {
    if (!isAbsoluteFolder(p)) return null
    const norm = p.replace(/\\/g, '/').replace(/\/+$/, '')
    let best: CloudBinding | null = null
    for (const b of cloudBindings()) {
      const root = b.localPath.replace(/\\/g, '/').replace(/\/+$/, '')
      if (norm === root || norm.startsWith(root + '/')) {
        if (!best || root.length > best.localPath.length) best = b
      }
    }
    if (!best) return null
    const account = findAccount(best.accountId)
    if (!account) return null
    const l = live.get(best.id) ?? liveOf(best.id)
    const root = best.localPath.replace(/\\/g, '/').replace(/\/+$/, '')
    return { provider: account.provider, state: entryState(l.state, l.dirty), root: norm === root }
  }

  return {
    start,
    stop,
    view,
    status,
    saveAccount,
    removeAccount,
    browse,
    createFolder,
    preview,
    saveBinding,
    updateBinding,
    removeBinding,
    run,
    wake,
    forPath,
    wipe: wipeCloud,
    bindingRoot: (id: string): string | null => findBinding(id)?.localPath ?? null,
    remotePathOf: (id: string): string | null => {
      const b = findBinding(id)
      return b ? `${b.accountId}\u0000${b.remoteId}` : null
    }
  }
}

export type CloudService = ReturnType<typeof createCloudService>
