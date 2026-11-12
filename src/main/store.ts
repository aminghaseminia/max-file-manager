/**
 * Persistent settings live in SQLite (`search.db`, table `app`) next to the search index. The
 * index's own `meta` table is wiped by "clear index"; `app` is not. The first run imports the old
 * state.json/window.json and leaves those files untouched as a recovery copy.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getAppKV, setAppKV } from './searchdb.ts'

const dbFile = () => path.join(app.getPath('userData'), 'search.db')

const readJson = (file: string): unknown => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  } catch {
    return null
  }
}

export function readStore<T>(key: string): T | null {
  try {
    const raw = getAppKV(dbFile(), key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeStore(key: string, value: unknown): void {
  setAppKV(dbFile(), key, JSON.stringify(value))
}

/** One-way import from the JSON files; the originals stay on disk as a backup. */
export function migrateLegacyStore(): void {
  const dir = app.getPath('userData')
  if (readStore('state') == null) {
    const old = readJson(path.join(dir, 'state.json'))
    if (old) writeStore('state', old)
  }
  if (readStore('window') == null) {
    const old = readJson(path.join(dir, 'window.json'))
    if (old) writeStore('window', old)
  }
}
