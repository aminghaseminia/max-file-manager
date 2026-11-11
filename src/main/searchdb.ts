import { DatabaseSync } from 'node:sqlite'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type SearchHit = {
  path: string
  name: string
  dir: boolean
  size: number
  mtime: number
  ext: string
}

export type IndexConfig = { roots: string[]; exclude: string[] }
export type IndexProgress = { scanned: number; added: number; done: number; total: number; root: string }

let db: DatabaseSync | null = null

export function openDb(file: string): DatabaseSync {
  if (db) return db
  const d = new DatabaseSync(file)
  d.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ext TEXT,
      dir INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      mtime INTEGER NOT NULL DEFAULT 0,
      root TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dirs (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      root TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(name, tokenize='unicode61 remove_diacritics 2');
    CREATE INDEX IF NOT EXISTS files_root ON files(root);
    CREATE INDEX IF NOT EXISTS dirs_root ON dirs(root);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  `)
  db = d
  return d
}

export function closeDb(): void {
  db?.close()
  db = null
}

/** "*.log" / "node_modules" style patterns, matched against the base name and the full path. */
export function excluded(p: string, patterns: string[]): boolean {
  if (!patterns.length) return false
  const base = p.split(/[\\/]/).pop() ?? p
  return patterns.some((raw) => {
    const pat = raw.trim()
    if (!pat) return false
    const rx = new RegExp(
      '^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    )
    return rx.test(base) || rx.test(p)
  })
}

const ftsInsert = (d: DatabaseSync, rowid: number | bigint, name: string) =>
  d.prepare('INSERT INTO fts(rowid, name) VALUES (?, ?)').run(rowid, name)
const ftsDelete = (d: DatabaseSync, rowid: number | bigint) =>
  d.prepare('DELETE FROM fts WHERE rowid = ?').run(rowid)

/**
 * Walks the configured roots and keeps the database in step. A folder whose mtime did not change
 * is skipped together with its subtree, which is what makes a re-index cheap.
 */
export async function indexRoots(
  file: string,
  config: IndexConfig,
  onProgress?: (p: IndexProgress) => void
): Promise<{ files: number; dirs: number; durationMs: number; roots: number }> {
  const d = openDb(file)
  const started = Date.now()
  let files = 0
  let dirs = 0
  const progress: IndexProgress = {
    scanned: 0,
    added: 0,
    done: 0,
    total: config.roots.length,
    root: ''
  }

  const upsert = d.prepare(
    `INSERT INTO files(path,name,ext,dir,size,mtime,root) VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(path) DO UPDATE SET name=excluded.name, ext=excluded.ext, dir=excluded.dir,
       size=excluded.size, mtime=excluded.mtime, root=excluded.root`
  )
  const rowidOf = d.prepare('SELECT rowid FROM files WHERE path = ?')
  const seenDir = d.prepare('SELECT mtime FROM dirs WHERE path = ?')
  const saveDir = d.prepare(
    `INSERT INTO dirs(path,mtime,root) VALUES(?,?,?)
     ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, root=excluded.root`
  )

  const indexOne = (full: string, name: string, isDir: boolean, size: number, mtime: number, root: string) => {
    const prev = rowidOf.get(full) as { rowid: number } | undefined
    const info = upsert.run(full, name, isDir ? '' : path.extname(name).slice(1).toLowerCase(), isDir ? 1 : 0, size, Math.round(mtime), root)
    const rowid = prev?.rowid ?? info.lastInsertRowid
    if (prev) ftsDelete(d, rowid)
    ftsInsert(d, rowid, name)
  }

  for (const root of config.roots) {
    if (!path.isAbsolute(root)) continue
    progress.root = root
    progress.done++
    const stack: string[] = [root]
    while (stack.length) {
      const dir = stack.pop()!
      const st = await fs.stat(dir).catch(() => null)
      if (!st || !st.isDirectory()) continue
      const seen = seenDir.get(dir) as { mtime: number } | undefined
      // unchanged folder: its subtree is skipped, which is why a re-index is cheap
      if (seen && Math.abs(seen.mtime - st.mtimeMs) < 1) continue
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (excluded(full, config.exclude)) continue
        progress.scanned++
        if (e.isDirectory()) {
          stack.push(full)
          indexOne(full, e.name, true, 0, st.mtimeMs, root)
          dirs++
        } else {
          const s = await fs.stat(full).catch(() => null)
          if (!s) continue
          indexOne(full, e.name, false, s.size, s.mtimeMs, root)
          files++
          progress.added++
        }
      }
      saveDir.run(dir, Math.round(st.mtimeMs), root)
      if (onProgress && progress.scanned % 400 === 0) onProgress(progress)
    }
  }

  // roots that are no longer configured drop out of the index
  const known = d.prepare('SELECT DISTINCT root FROM files').all() as { root: string }[]
  for (const r of known) {
    if (config.roots.includes(r.root)) continue
    for (const row of d.prepare('SELECT rowid, path FROM files WHERE root = ?').all(r.root) as any[]) {
      ftsDelete(d, row.rowid)
    }
    d.prepare('DELETE FROM files WHERE root = ?').run(r.root)
    d.prepare('DELETE FROM dirs WHERE root = ?').run(r.root)
  }

  d.prepare("INSERT INTO meta(k,v) VALUES('lastIndex',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(
    String(Date.now())
  )
  onProgress?.(progress)
  return { files, dirs, durationMs: Date.now() - started, roots: config.roots.length }
}

/** Fast name search: FTS prefix match first, substring fallback when the index has nothing. */
export function searchIndex(file: string, query: string, limit = 200): SearchHit[] {
  const q = query.trim()
  if (!q) return []
  const d = openDb(file)
  const safeLimit = Math.min(1000, Math.max(1, limit))
  const rows: SearchHit[] = []
  const push = (r: any) =>
    rows.push({
      path: String(r.path),
      name: String(r.name),
      dir: Number(r.dir) === 1,
      size: Number(r.size),
      mtime: Number(r.mtime),
      ext: String(r.ext ?? '')
    })

  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, ''))
    .filter(Boolean)
  if (tokens.length) {
    const match = tokens.map((t) => `"${t}"*`).join(' ')
    try {
      const stmt = d.prepare(
        `SELECT f.path,f.name,f.dir,f.size,f.mtime,f.ext FROM fts
         JOIN files f ON f.rowid = fts.rowid WHERE fts MATCH ? ORDER BY f.dir DESC, f.name LIMIT ?`
      )
      for (const r of stmt.all(match) as any[]) push(r)
    } catch {
      /* a bad MATCH expression must not break search */
    }
  }
  if (rows.length < 20) {
    const like = `%${q.replace(/[%_]/g, '')}%`
    const stmt = d.prepare(
      `SELECT path,name,dir,size,mtime,ext FROM files WHERE name LIKE ? ORDER BY dir DESC, name LIMIT ?`
    )
    for (const r of stmt.all(like, safeLimit) as any[]) {
      if (!rows.some((x) => x.path === String(r.path))) push(r)
      if (rows.length >= safeLimit) break
    }
  }
  return rows.slice(0, safeLimit)
}

export function indexStats(file: string): { files: number; dirs: number; lastIndex: number } {
  const d = openDb(file)
  const n = d.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }
  const dirCount = d.prepare('SELECT COUNT(*) AS n FROM dirs').get() as { n: number }
  const last = d.prepare("SELECT v FROM meta WHERE k='lastIndex'").get() as { v: string } | undefined
  return { files: Number(n?.n ?? 0), dirs: Number(dirCount?.n ?? 0), lastIndex: Number(last?.v ?? 0) }
}

/**
 * Folder sizes straight out of the index — instant, at the cost of being as fresh as the index.
 */
export function indexSizes(file: string, dirs: string[]): Record<string, { bytes: number; files: number }> {
  const d = openDb(file)
  const out: Record<string, { bytes: number; files: number }> = {}
  const stmt = d.prepare(
    "SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM files WHERE dir = 0 AND path LIKE ? ESCAPE '\\'"
  )
  for (const dir of dirs) {
    const like = dir.replace(/[%_\\]/g, (m) => '\\' + m) + '/%'
    try {
      const r = stmt.get(like) as { files: number; bytes: number } | undefined
      if (r && Number(r.files) > 0) {
        out[dir] = { files: Number(r.files), bytes: Number(r.bytes) }
      }
    } catch {
      /* a bad pattern must not break the caller */
    }
  }
  return out
}

export function clearIndex(file: string): void {
  const d = openDb(file)
  d.exec('DELETE FROM files; DELETE FROM fts; DELETE FROM dirs; DELETE FROM meta;')
}
