/**
 * Optional restic snapshot history for a **local** destination. The password is passed through the
 * environment (`RESTIC_PASSWORD`), never argv; the repository path and the source are absolute
 * local paths already validated by the service.
 *
 * One repository per destination (the default is `<destination>/.mfm-restic`) and one tag
 * (`mfm`), so `forget --keep-last N` only prunes this app's snapshots. A remote destination is
 * deliberately unsupported: restic's own SSH/S3 backends would duplicate the app's credential and
 * host-key model.
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SyncSnapshot } from '../shared/sync.ts'

export const VERSION_TAG = 'mfm'
let cached: boolean | null = null

/** `restic version`, cached; a missing binary is a normal answer. */
export async function resticAvailable(): Promise<boolean> {
  if (cached !== null) return cached
  cached = await new Promise<boolean>((resolve) => {
    try {
      execFile('restic', ['version'], { timeout: 4000 }, (err, out) => {
        resolve(!err && /restic\s+\d/i.test(String(out ?? '')))
      }).on('error', () => resolve(false))
    } catch {
      resolve(false)
    }
  })
  return cached
}

export function resetResticCache(): void {
  cached = null
}

type Run = { code: number; out: string; err: string }

function restic(args: string[], password: string, timeout = 300_000): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      'restic',
      args,
      {
        env: { ...process.env, RESTIC_PASSWORD: password },
        timeout,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true
      },
      (err, out, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? Number((err as { code: number }).code) : 1) : 0
        resolve({ code, out: String(out ?? ''), err: String(stderr ?? '') })
      }
    ).on('error', () => resolve({ code: 1, out: '', err: 'restic is not installed' }))
  })
}

const isDir = async (p: string): Promise<boolean> => {
  const st = await fs.stat(p).catch(() => null)
  return !!st?.isDirectory()
}

/** Create the repo if its `config` file is missing; an existing repo is left alone. */
export async function ensureRepo(repo: string, password: string): Promise<void> {
  if (!path.isAbsolute(repo)) throw new Error('the restic repository must be an absolute path')
  await fs.mkdir(repo, { recursive: true })
  if (!(await isDir(repo))) throw new Error('the restic repository is not a folder')
  const config = path.join(repo, 'config')
  try {
    await fs.access(config)
    return
  } catch {
    // not initialised yet
  }
  const res = await restic(['-r', repo, 'init', '--json'], password)
  if (res.code !== 0) throw new Error(res.err.trim() || 'restic init failed')
}

/** `restic snapshots --json` → the fields the UI shows; junk entries are dropped. */
export function parseSnapshots(text: string): SyncSnapshot[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const out: SyncSnapshot[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    const id = typeof s.id === 'string' ? s.id : ''
    const time = typeof s.time === 'string' ? s.time : ''
    if (!id || !time) continue
    const summary = s.summary && typeof s.summary === 'object' ? (s.summary as Record<string, unknown>) : {}
    out.push({
      id,
      shortId: typeof s.short_id === 'string' ? s.short_id : id.slice(0, 8),
      time,
      tags: Array.isArray(s.tags) ? s.tags.filter((t): t is string => typeof t === 'string') : [],
      paths: Array.isArray(s.paths) ? s.paths.filter((p): p is string => typeof p === 'string') : [],
      bytes: Number(summary.total_bytes_processed) || 0,
      files: Number(summary.total_files_processed) || 0
    })
  }
  return out
}

/** The last `message_type: summary` JSON line from `restic backup --json`. */
export function parseBackupSummary(text: string): { id: string; bytes: number; files: number } | null {
  let found: { id: string; bytes: number; files: number } | null = null
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>
      const id = typeof row.snapshot_id === 'string' ? row.snapshot_id : ''
      if (!id) continue
      found = {
        id,
        bytes: Number(row.total_bytes_processed) || 0,
        files: Number(row.total_files_processed) || 0
      }
    } catch {
      // a progress line, not a summary
    }
  }
  return found
}

export async function backup(
  repo: string,
  password: string,
  source: string,
  tag = VERSION_TAG
): Promise<{ id: string; bytes: number; files: number }> {
  await ensureRepo(repo, password)
  const res = await restic([
    '-r',
    repo,
    'backup',
    '--tag',
    tag,
    '--json',
    '--exclude',
    '.mfm-restic',
    '--exclude',
    '.mfm-trash',
    '--',
    source
  ], password)
  if (res.code !== 0) throw new Error(res.err.trim() || 'restic backup failed')
  const summary = parseBackupSummary(res.out)
  if (!summary) throw new Error('restic did not return a snapshot id')
  return summary
}

export async function snapshots(repo: string, password: string, tag = VERSION_TAG): Promise<SyncSnapshot[]> {
  const res = await restic(['-r', repo, 'snapshots', '--json', '--tag', tag], password)
  if (res.code !== 0) {
    if (/wrong password/i.test(res.err)) throw new Error('the restic repository password is wrong')
    if (/does not exist|unable to open config/i.test(res.err)) return []
    throw new Error(res.err.trim() || 'restic snapshots failed')
  }
  return parseSnapshots(res.out)
}

/** Keep the newest N snapshots of this tag, then prune unreferenced packs. */
export async function forget(repo: string, password: string, keep: number, tag = VERSION_TAG): Promise<void> {
  const n = Math.min(100, Math.max(1, Math.round(keep)))
  const res = await restic(['-r', repo, 'forget', '--keep-last', String(n), '--prune', '--tag', tag, '--json'], password)
  if (res.code !== 0) throw new Error(res.err.trim() || 'restic forget failed')
}

/**
 * Restore a snapshot into a fresh temp folder and return the folder that actually holds the
 * restored tree (restic recreates the snapshot's absolute path under the target).
 */
export async function restoreToTemp(repo: string, password: string, id: string): Promise<string> {
  if (!/^[0-9a-f]{8,64}$/i.test(id)) throw new Error('invalid snapshot id')
  const repoSnapshots = await snapshots(repo, password)
  const found = repoSnapshots.find((s) => s.id === id)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfm-restore-'))
  const res = await restic(['-r', repo, 'restore', id, '--target', dir, '--json'], password, 600_000)
  if (res.code !== 0) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    throw new Error(res.err.trim() || 'restic restore failed')
  }
  const rel = found?.paths[0]?.replace(/^[/\\]+/, '') ?? ''
  const candidate = rel ? path.join(dir, ...rel.split(/[/\\]+/)) : dir
  const st = await fs.stat(candidate).catch(() => null)
  return st ? candidate : dir
}
