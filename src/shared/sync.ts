/**
 * The shape of a synchronisation job, shared by the renderer (prefs), the main process (scheduler)
 * and the MCP tool table. Keeping it in `shared` is what stops the three from drifting apart.
 *
 * A path is either an absolute local path or a remote URI (`sftp://…`, `s3://…`); `isRemotePath`
 * and `path.isAbsolute` in main decide which store owns it.
 */
import { isRemotePath } from './remote-path.ts'

export type SyncCompareBy = 'mtime' | 'hash'
export type SyncMode = 'ltr' | 'rtl' | 'both'

export type SyncState =
  | 'same'
  | 'leftOnly'
  | 'rightOnly'
  | 'leftNewer'
  | 'rightNewer'
  | 'sizeDiff'
  | 'contentDiff'
  | 'typeDiff'
  | 'conflict'

export type ConflictKind = 'bothChanged' | 'editDelete' | 'bothNew' | 'typeDiff'

/** One side of one row. `hash` is filled only when the comparison asked for it. */
export type SyncSide = { size: number; mtime: number; dir: boolean; hash?: string }

export type SyncRow = {
  rel: string
  state: SyncState
  left?: SyncSide
  right?: SyncSide
  /** the last reconciled state of this path; only present in a two-way comparison */
  baseline?: SyncSide
  conflict?: ConflictKind
  /** a per-row decision the user made; only used for `both` (and for manual overrides) */
  resolution?: 'left' | 'right' | 'skip'
}

export type SyncAction = {
  rel: string
  kind: 'copy' | 'delete'
  from: 'left' | 'right'
  to: 'left' | 'right'
  state: SyncState
}

export type SyncPlan = {
  mode: SyncMode
  copy: SyncAction[]
  remove: SyncAction[]
  conflicts: SyncRow[]
  skipped: number
}

/** The rsync switches the UI exposes; every one is a separate argv entry, never a shell string. */
export type RsyncOptions = {
  /** compare by checksum instead of size+mtime */
  checksum?: boolean
  compress?: boolean
  /** KB/s ceiling */
  bwlimitKB?: number
  partial?: boolean
  inplace?: boolean
  sparse?: boolean
  hardLinks?: boolean
  /** preserve POSIX ACLs (`-A`) */
  acls?: boolean
  /** preserve extended attributes (`-X`) */
  xattrs?: boolean
}

/**
 * Per-side content encryption. The secret material is never here: `secretId` points at the OS
 * keyring store. `recipient` is the public age key (safe in prefs); the identity is the secret.
 */
export type SyncEncryption = {
  mode: 'passphrase' | 'keypair'
  secretId: string
  /** age1…; required for keypair mode when writing to this side */
  recipient?: string
}

/** A restic snapshot as the Versions tab shows it. */
export type SyncSnapshot = {
  id: string
  shortId: string
  time: string
  tags: string[]
  paths: string[]
  bytes: number
  files: number
}

/** restic snapshot history for a local destination. The password is a secret id, not data. */
export type SyncVersions = {
  keep: number
  /** absolute local repository; empty means <destination>/.mfm-restic */
  repo?: string
  secretId: string
}

export type SyncSchedule = {
  /** run once, shortly after the app starts */
  onStart?: boolean
  /** minutes between runs; 0/undefined = no interval */
  everyMinutes?: number
  /** a five-field cron expression */
  cron?: string
  /** run when a removable drive is mounted */
  onMount?: boolean
  /** run when a watched folder changes (local endpoints only) */
  onChange?: boolean
}

export type SyncJob = {
  id: string
  name: string
  left: string
  right: string
  /** the direction a manual «Run» uses unless the user picks another one */
  direction: SyncMode
  compareBy: SyncCompareBy
  /** wildcard names or relative paths, e.g. `*.log`, `node_modules` */
  ignore: string[]
  /** delete files that exist only on the destination (one-way) or on one side (two-way) */
  deleteExtra: boolean
  enabled: boolean
  schedule: SyncSchedule
  /** local ↔ local only; remote endpoints stay on the native engine */
  useRsync?: boolean
  rsync?: RsyncOptions
  encLeft?: SyncEncryption
  encRight?: SyncEncryption
  versions?: SyncVersions
}

export type SyncRunState = 'running' | 'done' | 'cancelled' | 'error'

export type SyncRunSummary = {
  id: string
  jobId?: string
  left: string
  right: string
  mode: SyncMode
  compareBy: SyncCompareBy
  state: SyncRunState
  startedAt: number
  finishedAt?: number
  copied: number
  removed: number
  skipped: number
  bytes: number
  conflicts: number
  errors: string[]
}

export type SyncProgress = {
  id: string
  jobId?: string
  state: SyncRunState
  done: number
  total: number
  files: number
  filesDone: number
  bytes: number
  bytesDone: number
  current: string
  errors: string[]
  /** pause/resume is a state of the run, not a lost event */
  paused?: boolean
}

export const SYNC_JOB_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_JOBS = 50
const MAX_IGNORE = 50
const MAX_PATH = 4096

export const isSyncPath = (p: unknown): p is string =>
  typeof p === 'string' &&
  p.length > 0 &&
  p.length <= MAX_PATH &&
  (isRemotePath(p) || p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || /^\\\\[^\\]+\\/.test(p))

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Five fields, digits/stars/ranges/lists — enough for the app, and never a shell string. */
export function cleanCron(raw: unknown): string {
  const v = text(raw, 80)
  if (!v) return ''
  const fields = v.split(/\s+/)
  if (fields.length !== 5) return ''
  return fields.every((f) => /^[0-9*/,\-]+$/.test(f)) ? v : ''
}

function cleanIgnore(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const value of raw) {
    const v = text(value, 120)
    if (!v || v === '.' || v === '..' || /[\0\r\n]/.test(v)) continue
    if (!out.includes(v)) out.push(v)
    if (out.length >= MAX_IGNORE) break
  }
  return out
}

export function cleanSchedule(raw: unknown): SyncSchedule {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const every = Number(s.everyMinutes)
  return {
    onStart: s.onStart === true,
    everyMinutes: Number.isFinite(every) && every >= 1 ? Math.min(10080, Math.round(every)) : undefined,
    cron: cleanCron(s.cron) || undefined,
    onMount: s.onMount === true,
    onChange: s.onChange === true
  }
}

export function cleanSyncJob(raw: unknown): SyncJob | null {
  if (!raw || typeof raw !== 'object') return null
  const j = raw as Record<string, unknown>
  const id = text(j.id, 64)
  if (!SYNC_JOB_ID.test(id)) return null
  const left = text(j.left, MAX_PATH)
  const right = text(j.right, MAX_PATH)
  if (!isSyncPath(left) || !isSyncPath(right) || left === right) return null
  const direction = j.direction === 'rtl' || j.direction === 'both' ? j.direction : 'ltr'
  const compareBy = j.compareBy === 'hash' ? 'hash' : 'mtime'
  const name = text(j.name, 80) || id
  const encLeft = cleanEncryption(j.encLeft)
  const encRight = cleanEncryption(j.encRight)
  const versions = cleanVersions(j.versions)
  if (encLeft === null || encRight === null || versions === null) return null
  // restic history is one-way and local; a job that could never take a snapshot is rejected
  if (versions) {
    const dest = direction === 'rtl' ? left : right
    if (direction === 'both' || isRemotePath(dest)) return null
  }
  const localOnly = !isRemotePath(left) && !isRemotePath(right)
  // rsync cannot encrypt/decrypt; a job with an encrypted side always uses the native engine
  const useRsync = localOnly && j.useRsync === true && !encLeft && !encRight
  return {
    id,
    name,
    left,
    right,
    direction,
    compareBy,
    ignore: cleanIgnore(j.ignore),
    deleteExtra: j.deleteExtra === true,
    enabled: j.enabled !== false,
    schedule: cleanSchedule(j.schedule),
    useRsync,
    ...(useRsync ? { rsync: cleanRsyncOptions(j.rsync) } : {}),
    ...(encLeft ? { encLeft } : {}),
    ...(encRight ? { encRight } : {}),
    ...(versions ? { versions } : {})
  }
}

const SECRET_ID = /^[a-z0-9][a-z0-9-]{7,63}$/
const RECIPIENT = /^age1[0-9a-z]{20,}$/i

/** Invalid encryption config must reject the job, not silently run it in plaintext. */
/** Invalid version config must reject the job; silently running without the promised history is worse. */
export function cleanVersions(raw: unknown): SyncVersions | undefined | null {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  const secretId = typeof v.secretId === 'string' ? v.secretId.trim() : ''
  if (!SECRET_ID.test(secretId)) return null
  const keep = Number(v.keep)
  const repo = typeof v.repo === 'string' ? v.repo.trim() : ''
  if (repo && (!isSyncPath(repo) || isRemotePath(repo))) return null
  return {
    keep: Number.isFinite(keep) && keep >= 1 ? Math.min(100, Math.round(keep)) : 5,
    ...(repo ? { repo } : {}),
    secretId
  }
}

export function cleanEncryption(raw: unknown): SyncEncryption | undefined | null {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const mode = e.mode === 'passphrase' || e.mode === 'keypair' ? e.mode : null
  const secretId = typeof e.secretId === 'string' ? e.secretId.trim() : ''
  if (!mode || !SECRET_ID.test(secretId)) return null
  const recipient = typeof e.recipient === 'string' ? e.recipient.trim() : ''
  if (recipient && !RECIPIENT.test(recipient)) return null
  return { mode, secretId, ...(recipient ? { recipient } : {}) }
}

const RSYNC_FLAGS = [
  'checksum',
  'compress',
  'partial',
  'inplace',
  'sparse',
  'hardLinks',
  'acls',
  'xattrs'
] as const

/** Only known booleans and a sane bandwidth number survive; anything else is dropped. */
export function cleanRsyncOptions(raw: unknown): RsyncOptions {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: RsyncOptions = {}
  for (const key of RSYNC_FLAGS) if (src[key] === true) out[key] = true
  const bw = Number(src.bwlimitKB)
  if (Number.isFinite(bw) && bw > 0) out.bwlimitKB = Math.min(1_000_000, Math.round(bw))
  return out
}

/** Invalid jobs are dropped one by one; one bad entry must never stop the app from booting. */
export function cleanSyncJobs(raw: unknown): SyncJob[] {
  if (!Array.isArray(raw)) return []
  const out: SyncJob[] = []
  const ids = new Set<string>()
  for (const value of raw) {
    const job = cleanSyncJob(value)
    if (!job || ids.has(job.id)) continue
    ids.add(job.id)
    out.push(job)
    if (out.length >= MAX_JOBS) break
  }
  return out
}

export function cleanPairDirs(raw: unknown): Record<string, SyncMode> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, SyncMode> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k.length > 9000) continue
    if (v !== 'ltr' && v !== 'rtl' && v !== 'both') continue
    out[k] = v
    if (Object.keys(out).length >= 100) break
  }
  return out
}

/** A stable key for «the direction of this pair of panes», independent of which side is active. */
export const pairKey = (left: string, right: string): string => `${left}\u0000${right}`

export function jobKey(job: Pick<SyncJob, 'left' | 'right'>): string {
  return pairKey(job.left, job.right)
}

export function newSyncJobId(existing: Iterable<string>): string {
  const taken = new Set(existing)
  for (let i = 1; i < 10_000; i++) {
    const id = `sync-${i}`
    if (!taken.has(id)) return id
  }
  return `sync-${Date.now().toString(36)}`
}
