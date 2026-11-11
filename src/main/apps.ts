/**
 * The system's «open with» list and a launcher that actually starts the chosen app.
 *
 * Electron's `shell.openPath` returns an empty string even when `xdg-open` fails, and some
 * desktops are launched without `XDG_CURRENT_DESKTOP`, so a file can silently never open.
 * Here the failure is detectable, and the app list is parsed from the `.desktop` files the
 * user already has — no network, no extra dependency.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'

export type DesktopApp = { id: string; name: string; exec: string; icon: string; desktop: string }

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/x-wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  apk: 'application/vnd.android.package-archive',
  deb: 'application/vnd.debian.binary-package',
  sh: 'application/x-shellscript'
}

/** The MIME type a desktop file would be matched against; unknown files fall back to text/plain. */
export function mimeForPath(p: string): string {
  const ext = path.extname(p).slice(1).toLowerCase()
  return EXT_MIME[ext] ?? 'application/octet-stream'
}

/** Values of a `[Desktop Entry]` group, last occurrence wins (the spec allows repeats). */
export function parseDesktopEntry(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  let inEntry = false
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      inEntry = trimmed === '[Desktop Entry]'
      continue
    }
    if (!inEntry || !trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

/** True when the entry is a visible application that claims this MIME type. */
export function appHandles(entry: Record<string, string>, mime: string): boolean {
  if (entry['Type'] !== 'Application' || !entry['Exec']) return false
  if (entry['NoDisplay'] === 'true' || entry['Hidden'] === 'true') return false
  const types = (entry['MimeType'] ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  return types.includes(mime)
}

const splitExec = (exec: string): string[] => {
  const out: string[] = []
  let current = ''
  let quote = ''
  for (const ch of exec) {
    if (quote) {
      if (ch === quote) quote = ''
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current) out.push(current)
  return out
}

/** `Exec=` → argv, with the file token replaced (and the other specifiers removed). */
export function execFor(exec: string, file: string): string[] {
  const argv: string[] = []
  for (const token of splitExec(exec)) {
    if (/^%[fFuUdDnNickvm]$/.test(token)) {
      if (token === '%f' || token === '%F' || token === '%u' || token === '%U') argv.push(file)
      continue
    }
    argv.push(token.replace(/^%i/, ''))
  }
  return argv.filter((part) => !part.startsWith('%%'))
}

/** Ask the desktop which application is the default for this MIME type. */
const defaultDesktopName = (mime: string): Promise<string> =>
  new Promise((resolve) => {
    const child = execFile('xdg-mime', ['query', 'default', mime], { timeout: 2000 }, (err, out) => {
      resolve(err ? '' : String(out).trim())
    })
    child.on('error', () => resolve(''))
  })

/** Resolve a desktop file name (`foo.desktop`) to the full path the app dirs hold. */
async function findDesktop(name: string): Promise<string | null> {
  if (!name) return null
  for (const dir of appDirs()) {
    const full = path.join(dir, name)
    if (await fs.access(full).then(() => true, () => false)) return full
  }
  return null
}

/**
 * The system's default handler for this file, launched the same way «Open with» does.
 * `shell.openPath` cannot be trusted to report failure, so the default app is started
 * directly; only when no default exists do the generic openers take over.
 */
export async function openWithDefault(file: string): Promise<{ ok: true } | { error: string }> {
  const desktop = await findDesktop(await defaultDesktopName(mimeForPath(file)))
  if (desktop) {
    const result = await launchApp(desktop, file)
    if ('ok' in result) return result
  }
  for (const [cmd, args] of [
    ['gio', ['open', file]],
    ['xdg-open', [file]],
    ['kioclient5', ['exec', file]],
    ['kde-open5', [file]]
  ] as [string, string[]][]) {
    if (await spawnDetached(cmd, args)) return { ok: true }
  }
  return { error: 'open_failed' }
}

/** The desktop's default handler for this file, or null when the MIME has none. */
export async function defaultApp(file: string): Promise<{ id: string; name: string } | null> {
  const desktop = await findDesktop(await defaultDesktopName(mimeForPath(file)))
  if (!desktop) return null
  const entry = parseDesktopEntry(await fs.readFile(desktop, 'utf8').catch(() => ''))
  return { id: desktop, name: entry['Name'] ?? path.basename(desktop, '.desktop') }
}

/** Launch a helper and treat a clean quick exit as success; it is never waited on. */
export const spawnDetached = (cmd: string, args: string[]): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
      child.on('error', () => done(false))
      child.on('exit', (code) => done(code === 0))
      child.on('spawn', () => setTimeout(() => done(true), 1200))
      child.unref()
    } catch {
      done(false)
    }
  })

const appDirs = (): string[] => {
  const dirs = [path.join(os.homedir(), '.local/share/applications'), '/usr/share/applications']
  for (const base of (process.env['XDG_DATA_DIRS'] ?? '').split(':')) {
    if (base) dirs.push(path.join(base, 'applications'))
  }
  return [...new Set(dirs)]
}

/** Every application that advertises the file's MIME type, alphabetically by name. */
export async function listApps(p: string): Promise<DesktopApp[]> {
  const mime = mimeForPath(p)
  const seen = new Set<string>()
  const apps: DesktopApp[] = []
  for (const dir of appDirs()) {
    const files = await fs.readdir(dir).catch(() => [])
    for (const file of files) {
      if (!file.endsWith('.desktop')) continue
      const full = path.join(dir, file)
      const entry = parseDesktopEntry(await fs.readFile(full, 'utf8').catch(() => ''))
      if (!appHandles(entry, mime)) continue
      const name = entry['Name'] ?? file.replace(/\.desktop$/, '')
      if (seen.has(name) || !entry['Exec']) continue
      seen.add(name)
      apps.push({
        id: full,
        name,
        exec: entry['Exec'],
        icon: entry['Icon'] ?? '',
        desktop: full
      })
    }
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name))
}

/** Start an app and resolve as soon as the process exists; it is not waited on. */
export async function launchApp(
  id: string,
  file: string
): Promise<{ ok: true } | { error: string }> {
  const entry = parseDesktopEntry(await fs.readFile(id, 'utf8').catch(() => ''))
  if (!entry['Exec']) return { error: 'app_not_found' }
  const argv = execFor(entry['Exec'], file)
  if (!argv.length) return { error: 'app_not_found' }
  try {
    const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore' })
    child.on('error', () => undefined)
    child.unref()
    return { ok: true }
  } catch {
    return { error: 'launch_failed' }
  }
}
