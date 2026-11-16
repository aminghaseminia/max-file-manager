/**
 * Optional rsync engine for **local ↔ local** one-way runs. Remote endpoints stay on the native
 * engine: rsync over ssh would bypass the app's own host-key and credential handling.
 *
 * The preview is rsync's own `--dry-run --itemize-changes` output, not a second implementation, so
 * what the user confirms is exactly what runs. Every switch is a separate argv entry; nothing is
 * ever passed through a shell. Deletions use `--backup --backup-dir=<dst>/.mfm-trash/<stamp>`, so
 * an rsync run still leaves a recoverable copy instead of a permanent delete.
 */
import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isRemotePath } from '../shared/remote-path.ts'
import type { RsyncOptions, SyncAction, SyncMode, SyncPlan, SyncRow } from '../shared/sync.ts'

export type RsyncControl = { cancelled: boolean; paused: boolean }

export type RsyncRequest = {
  src: string
  dst: string
  mode: SyncMode
  deleteExtra: boolean
  ignore: string[]
  compareBy: 'mtime' | 'hash'
  options?: RsyncOptions
  /** where `--delete` moves files; required by the service when deleteExtra is on */
  backupDir?: string
}

const MAX_ITEMS = 20_000

let cached: boolean | null = null

/** `rsync --version`, cached for the process; a missing binary is a normal, recoverable answer. */
export async function rsyncAvailable(): Promise<boolean> {
  if (cached !== null) return cached
  cached = await new Promise<boolean>((resolve) => {
    try {
      const child = execFile('rsync', ['--version'], { timeout: 4000 }, (err, out) => {
        resolve(!err && /rsync\s+version/i.test(String(out ?? '')))
      })
      child.on('error', () => resolve(false))
    } catch {
      resolve(false)
    }
  })
  return cached
}

/** Only a test hook. */
export function resetRsyncCache(): void {
  cached = null
}

const withSlash = (p: string): string => {
  const normal = process.platform === 'win32' ? p.replace(/\\/g, '/') : p
  return normal.endsWith('/') ? normal : normal + '/'
}

/**
 * Build the argv. `--update` implements «newer wins» for mtime comparison; hash comparison ignores
 * timestamps, so it must not ask rsync to skip an older-but-different file.
 */
export function rsyncArgs(req: RsyncRequest, dryRun: boolean, progress: boolean): string[] {
  const a: string[] = ['-a', '--protect-args', '--itemize-changes', '--out-format=%i|%n']
  if (req.compareBy === 'hash' || req.options?.checksum) a.push('--checksum')
  else a.push('--update')
  if (req.deleteExtra) {
    a.push('--delete')
    if (req.backupDir) a.push('--backup', `--backup-dir=${req.backupDir}`)
  }
  if (req.options?.compress) a.push('--compress')
  if (req.options?.bwlimitKB && req.options.bwlimitKB > 0) a.push(`--bwlimit=${Math.round(req.options.bwlimitKB)}`)
  if (req.options?.partial) a.push('--partial')
  if (req.options?.inplace) a.push('--inplace')
  if (req.options?.sparse) a.push('--sparse')
  if (req.options?.hardLinks) a.push('--hard-links')
  if (req.options?.acls) a.push('--acls')
  if (req.options?.xattrs) a.push('--xattrs')
  // app metadata, the trash and the version repository live inside the tree; never mirror them
  a.push('--exclude=.mfm.json', '--exclude=.mfm-versions', '--exclude=.mfm-trash', '--exclude=.mfm-restic')
  for (const pattern of req.ignore) if (pattern) a.push(`--exclude=${pattern}`)
  if (dryRun) a.push('--dry-run')
  if (progress) a.push('--info=progress2')
  a.push('--', withSlash(req.src), withSlash(req.dst))
  return a
}

export type RsyncItem = { rel: string; kind: 'file' | 'delete' | 'other' }

/** `%i|%n` lines → the actions the plan can show. Dirs, links and hardlinks are left to rsync. */
export function parseItemize(text: string): { items: RsyncItem[]; capped: boolean } {
  const items: RsyncItem[] = []
  let capped = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line) continue
    const bar = line.indexOf('|')
    if (bar < 0) continue
    const code = line.slice(0, bar).trim()
    let rel = line.slice(bar + 1).replace(/\/+$/, '')
    if (!rel) continue
    // rsync prints the source path as given for some deletions; keep it relative
    rel = rel.replace(/^\.\//, '')
    let kind: RsyncItem['kind'] = 'other'
    if (code.startsWith('*deleting')) kind = 'delete'
    else if (code.startsWith('>f') || code.startsWith('cf')) kind = 'file'
    if (kind === 'other') continue
    if (items.length >= MAX_ITEMS) {
      capped = true
      break
    }
    items.push({ rel, kind })
  }
  return { items, capped }
}

export function itemizeToPlan(items: RsyncItem[], mode: SyncMode): { copy: SyncAction[]; remove: SyncAction[] } {
  const copy: SyncAction[] = []
  const remove: SyncAction[] = []
  const src = mode === 'rtl' ? 'right' : 'left'
  const dst = mode === 'rtl' ? 'left' : 'right'
  const deleteState = mode === 'rtl' ? 'leftOnly' : 'rightOnly'
  for (const item of items) {
    if (item.kind === 'file') {
      copy.push({ rel: item.rel, kind: 'copy', from: src, to: dst, state: 'contentDiff' })
    } else if (item.kind === 'delete') {
      remove.push({ rel: item.rel, kind: 'delete', from: dst, to: dst, state: deleteState })
    }
  }
  return { copy, remove }
}

/** The last «  1,234,567  45%» snapshot in a progress line. */
export function parseProgress(text: string): { bytes: number; pct: number } | null {
  const matches = [...text.matchAll(/([\d,]+)\s+(\d+)%/g)]
  const last = matches[matches.length - 1]
  if (!last) return null
  const bytes = Number(last[1].replace(/,/g, ''))
  const pct = Number(last[2])
  if (!Number.isFinite(bytes) || !Number.isFinite(pct)) return null
  return { bytes, pct }
}

type Runner = {
  onLine?(line: string): void
  onProgress?(p: { bytes: number; pct: number }): void
  ctl?: RsyncControl
}

/** Run rsync and stream its itemized/progress output. Resolves even for a non-zero exit. */
export function spawnRsync(
  args: string[],
  runner: Runner = {}
): Promise<{ code: number | null; stderr: string; cancelled: boolean }> {
  return new Promise((resolve) => {
    const child = spawn('rsync', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let buf = ''
    let err = ''
    let stopped = false
    let killTimer: ReturnType<typeof setTimeout> | null = null
    const stop = (): void => {
      if (stopped) return
      stopped = true
      if (process.platform !== 'win32' && runner.ctl?.paused) child.kill('SIGCONT')
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2500)
      killTimer.unref?.()
    }
    const timer = setInterval(() => {
      if (runner.ctl?.cancelled) stop()
      else if (process.platform !== 'win32' && runner.ctl) {
        if (runner.ctl.paused && !stopped) {
          try {
            child.kill('SIGSTOP')
          } catch {
            // the process already exited
          }
        } else if (!runner.ctl.paused && !stopped) {
          try {
            child.kill('SIGCONT')
          } catch {
            // not stopped
          }
        }
      }
    }, 250)
    timer.unref?.()
    const handleLine = (line: string): void => {
      if (!line) return
      if (line.includes('|')) runner.onLine?.(line)
      const p = parseProgress(line)
      if (p) runner.onProgress?.(p)
    }
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString('utf8')
      const parts = buf.split(/\r\n|\n|\r/)
      buf = parts.pop() ?? ''
      if (buf.length > 65_536) buf = buf.slice(-4096)
      for (const part of parts) handleLine(part)
    })
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString('utf8')
      if (err.length > 16_384) err = err.slice(-4096)
    })
    child.on('error', (e: Error) => {
      clearInterval(timer)
      if (killTimer) clearTimeout(killTimer)
      resolve({ code: null, stderr: `${e.message}\n${err}`.trim(), cancelled: runner.ctl?.cancelled === true })
    })
    child.on('close', (code) => {
      clearInterval(timer)
      if (killTimer) clearTimeout(killTimer)
      if (buf) handleLine(buf)
      resolve({ code, stderr: err, cancelled: runner.ctl?.cancelled === true })
    })
  })
}

const statOf = async (p: string): Promise<{ size: number; mtime: number; dir: boolean } | null> => {
  const st = await fs.lstat(p).catch(() => null)
  if (!st) return null
  return { size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs, dir: st.isDirectory() }
}

const rowOfAction = async (
  action: SyncAction,
  leftRoot: string,
  rightRoot: string
): Promise<SyncRow> => {
  if (action.kind === 'delete') {
    const at = await statOf(path.join(action.from === 'left' ? leftRoot : rightRoot, action.rel))
    return {
      rel: action.rel,
      state: action.state,
      ...(action.from === 'left' ? { left: at ?? undefined } : { right: at ?? undefined })
    }
  }
  const [left, right] = await Promise.all([
    statOf(path.join(leftRoot, action.rel)),
    statOf(path.join(rightRoot, action.rel))
  ])
  return { rel: action.rel, state: action.state, left: left ?? undefined, right: right ?? undefined }
}

export type RsyncPlanResult = {
  rows: SyncRow[]
  plan: SyncPlan
  capped: boolean
}

/** Compare + plan entirely through rsync's dry run. Both sides must already be validated local. */
export async function planRsync(req: RsyncRequest): Promise<RsyncPlanResult> {
  if (isRemotePath(req.src) || isRemotePath(req.dst)) throw new Error('rsync is local only')
  if (req.mode === 'both') throw new Error('rsync is one-way only')
  if (!(await rsyncAvailable())) throw new Error('rsync is not installed')
  const lines: string[] = []
  const res = await spawnRsync(rsyncArgs(req, true, false), { onLine: (l) => lines.push(l) })
  if (res.code !== 0) throw new Error(res.stderr.trim() || `rsync exited with ${res.code}`)
  const parsed = parseItemize(lines.join('\n'))
  const { copy, remove } = itemizeToPlan(parsed.items, req.mode)
  const [leftRoot, rightRoot] = req.mode === 'rtl' ? [req.dst, req.src] : [req.src, req.dst]
  const actions = [...copy, ...remove]
  const rows: SyncRow[] = []
  for (let i = 0; i < actions.length; i += 64) {
    const batch = await Promise.all(
      actions.slice(i, i + 64).map((a) => rowOfAction(a, leftRoot, rightRoot))
    )
    rows.push(...batch)
  }
  rows.sort((a, b) => a.rel.localeCompare(b.rel))
  return {
    rows,
    plan: { mode: req.mode, copy, remove, conflicts: [], skipped: 0 },
    capped: parsed.capped
  }
}

export type RsyncApplyResult = {
  copied: number
  removed: number
  skipped: number
  bytes: number
  errors: string[]
  cancel: boolean
}

/** Apply the exact same request the plan came from. The caller supplies the backup dir. */
export async function applyRsync(
  req: RsyncRequest,
  ctl: RsyncControl,
  onFile?: (rel: string) => void,
  onBytes?: (delta: number) => void
): Promise<RsyncApplyResult> {
  if (isRemotePath(req.src) || isRemotePath(req.dst)) throw new Error('rsync is local only')
  if (!(await rsyncAvailable())) throw new Error('rsync is not installed')
  if (req.deleteExtra && req.backupDir) await fs.mkdir(req.backupDir, { recursive: true })
  let copied = 0
  let removed = 0
  let seenBytes = 0
  const res = await spawnRsync(rsyncArgs(req, false, true), {
    ctl,
    onLine: (line) => {
      const parsed = parseItemize(line).items[0]
      if (!parsed) return
      if (parsed.kind === 'file') copied++
      else if (parsed.kind === 'delete') removed++
      onFile?.(parsed.rel)
    },
    onProgress: (p) => {
      const delta = Math.max(0, p.bytes - seenBytes)
      seenBytes = p.bytes
      if (delta) onBytes?.(delta)
    }
  })
  const errors: string[] = []
  if (res.code !== 0 && !res.cancelled) errors.push(res.stderr.trim() || `rsync exited with ${res.code}`)
  return { copied, removed, skipped: 0, bytes: seenBytes, errors, cancel: res.cancelled }
}

/** A timestamped trash directory inside the destination; one per run. */
export function trashDirFor(dst: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return path.join(dst, '.mfm-trash', stamp)
}
