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

export type DesktopApp = {
  id: string
  name: string
  exec: string
  icon: string
  desktop: string
  /** absolute icon file the renderer can show, '' when the theme has none */
  iconPath: string
  /** the desktop's current handler for this MIME type */
  isDefault: boolean
}

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
 * The system launcher for a platform that has no `.desktop` registry, or null on Linux.
 * Pure so the argv is testable without opening a real file.
 */
export function systemOpenCommand(
  platform: NodeJS.Platform | string,
  file: string
): [cmd: string, args: string[]] | null {
  if (platform === 'darwin') return ['open', [file]]
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', file]]
  return null
}

/**
 * macOS and Windows have no `.desktop` registry: hand the file to the OS launcher and read the
 * exit code, so a missing handler is reported instead of silently dropped. `open` on macOS exits
 * non-zero and prints the reason when nothing claims the type.
 */
const openWithSystem = (cmd: string, args: string[]): Promise<{ ok: true } | { error: string }> =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000 }, (err, _out, stderr) => {
      if (!err) {
        resolve({ ok: true })
        return
      }
      const msg = String(stderr || err.message || '').trim()
      resolve({ error: msg || 'open_failed' })
    })
  })

/**
 * The system's default handler for this file, launched the same way «Open with» does.
 * `shell.openPath` cannot be trusted to report failure, so the default app is started
 * directly; only when no default exists do the generic openers take over.
 */
export async function openWithDefault(file: string): Promise<{ ok: true } | { error: string }> {
  // The `.desktop` path below is Linux-only; every other platform would fall through to
  // gio/xdg-open/kioclient and report «no application» even when Finder or Explorer has one.
  const native = systemOpenCommand(process.platform, file)
  if (native) return openWithSystem(native[0], native[1])
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

const iconExists = (p: string): Promise<boolean> => fs.access(p).then(() => true, () => false)

/** Themes that between them cover KDE, GNOME, Xfce and most icon packs; the full tree is too slow. */
const ICON_THEMES = ['hicolor', 'breeze', 'breeze-dark', 'Adwaita', 'Yaru', 'Papirus', 'oxygen', 'Tango']
const ICON_SIZES = ['256x256', '128x128', '64x64', '48x48', '32x32', 'scalable', 'symbolic']

const iconCache = new Map<string, string>()

/**
 * Resolve a `.desktop` `Icon=` name to a real file. Absolute paths are used as given; a name is
 * looked up in pixmaps and in the common themes' `apps` folders (cached — a listing asks once
 * per application).
 */
export async function appIconPath(icon: string): Promise<string> {
  if (!icon) return ''
  if (path.isAbsolute(icon)) return (await iconExists(icon)) ? icon : ''
  const cached = iconCache.get(icon)
  if (cached !== undefined) return cached
  const names = [`${icon}.svg`, `${icon}.png`, `${icon}.xpm`]
  const roots = [path.join(os.homedir(), '.local/share/icons'), '/usr/share/icons', '/usr/share/pixmaps']
  for (const base of (process.env['XDG_DATA_DIRS'] ?? '').split(':')) {
    if (base) roots.push(path.join(base, 'icons'))
  }
  for (const name of names) {
    const direct = path.join('/usr/share/pixmaps', name)
    if (await iconExists(direct)) {
      iconCache.set(icon, direct)
      return direct
    }
  }
  for (const root of roots) {
    for (const theme of ICON_THEMES) {
      for (const size of ICON_SIZES) {
        for (const name of names) {
          const full = path.join(root, theme, size, 'apps', name)
          if (await iconExists(full)) {
            iconCache.set(icon, full)
            return full
          }
        }
      }
    }
  }
  iconCache.set(icon, '')
  return ''
}

/** Every application that advertises the file's MIME type, the default one first. */
export async function listApps(p: string, all = false): Promise<DesktopApp[]> {
  const mime = mimeForPath(p)
  const defaultName = await defaultDesktopName(mime)
  const seen = new Set<string>()
  const apps: DesktopApp[] = []
  for (const dir of appDirs()) {
    const files = await fs.readdir(dir).catch(() => [])
    for (const file of files) {
      if (!file.endsWith('.desktop')) continue
      const full = path.join(dir, file)
      const entry = parseDesktopEntry(await fs.readFile(full, 'utf8').catch(() => ''))
      // «all» is Dolphin's «all applications» page: anything launchable, not just this MIME
      const usable = all
        ? entry['Type'] === 'Application' &&
          !!entry['Exec'] &&
          entry['NoDisplay'] !== 'true' &&
          entry['Hidden'] !== 'true'
        : appHandles(entry, mime)
      if (!usable) continue
      const name = entry['Name'] ?? file.replace(/\.desktop$/, '')
      if (seen.has(name) || !entry['Exec']) continue
      seen.add(name)
      apps.push({
        id: full,
        name,
        exec: entry['Exec'],
        icon: entry['Icon'] ?? '',
        desktop: full,
        iconPath: '',
        isDefault: !!defaultName && path.basename(full) === defaultName
      })
    }
  }
  // resolving icons is filesystem work: do it in small parallel batches, not one stat chain per app
  for (let i = 0; i < apps.length; i += 16) {
    await Promise.all(
      apps.slice(i, i + 16).map(async (app) => {
        app.iconPath = await appIconPath(app.icon)
      })
    )
  }
  return apps.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
}

/** What the «Open with» sheet needs: the type, the current handler and the apps. */
export async function openWithInfo(
  file: string,
  all = false
): Promise<{ mime: string; canSetDefault: boolean; apps: DesktopApp[] }> {
  return {
    mime: mimeForPath(file),
    canSetDefault: process.platform === 'linux',
    apps: await listApps(file, all)
  }
}

/** Make a desktop entry the system handler for this file's type (`xdg-mime`, user scope). */
export async function setDefaultApp(
  file: string,
  desktopPath: string
): Promise<{ ok: true } | { error: string }> {
  if (process.platform !== 'linux') return { error: 'unsupported' }
  if (!path.isAbsolute(desktopPath)) return { error: 'bad_path' }
  // only an application MFM can actually list may be written to the association file
  const known = await listApps(file, true)
  if (!known.some((a) => a.id === desktopPath)) return { error: 'unknown_app' }
  const mime = mimeForPath(file)
  return new Promise((resolve) => {
    execFile(
      'xdg-mime',
      ['default', path.basename(desktopPath), mime],
      { timeout: 4000 },
      (err, _out, stderr) => {
        if (err) resolve({ error: String(stderr || err.message || 'failed').trim() })
        else resolve({ ok: true })
      }
    )
  })
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

/** Query whether max-file-manager is currently the default handler for inode/directory. */
export async function isDefaultFileManager(): Promise<boolean> {
  if (process.platform === 'linux') {
    const current = await defaultDesktopName('inode/directory')
    return current.includes('max-file-manager') || current.includes('mfm')
  }
  return false
}

/** Set max-file-manager as the system default file manager (inode/directory). */
export async function setDefaultFileManager(
  execPath?: string,
  appPath?: string
): Promise<{ ok: boolean; error?: string }> {
  if (process.platform === 'linux') {
    const home = os.homedir()
    const appDir = path.join(home, '.local', 'share', 'applications')
    const desktopFile = path.join(appDir, 'max-file-manager.desktop')
    const bin = execPath || process.execPath
    const dir = appPath || process.cwd()
    const iconPath = path.join(dir, 'build', 'icon.png')
    const content = `[Desktop Entry]
Type=Application
Version=1.0
Name=مدیر فایل مکس
Name[en]=Max File Manager
Comment=File manager (dual pane, tabs, sync)
Comment[en]=Dual-pane file manager
Exec=${bin} ${dir} %U
Icon=${iconPath}
Terminal=false
Categories=System;FileManager;Utility;
MimeType=inode/directory;x-scheme-handler/file;application/x-gnome-saved-search;
Keywords=files;manager;explorer;
StartupNotify=true
StartupWMClass=max-file-manager
`
    await fs.mkdir(appDir, { recursive: true }).catch(() => {})
    await fs.writeFile(desktopFile, content, 'utf8').catch(() => {})

    // Install org.freedesktop.FileManager1 DBus services so Firefox, Chrome, etc. use max-file-manager
    const dbusDir = path.join(home, '.local', 'share', 'dbus-1', 'services')
    const bridgeScript = path.join(dir, 'src', 'main', 'filemanager1-bridge.py')
    if (await fs.access(bridgeScript).then(() => true, () => false)) {
      await fs.mkdir(dbusDir, { recursive: true }).catch(() => {})
      const srvContent = `[D-BUS Service]\nName=org.freedesktop.FileManager1\nExec=${bridgeScript}\n`
      await fs.writeFile(path.join(dbusDir, 'org.freedesktop.FileManager1.service'), srvContent, 'utf8').catch(() => {})
      await fs.writeFile(path.join(dbusDir, 'org.kde.dolphin.FileManager1.service'), srvContent, 'utf8').catch(() => {})

      // Mask & stop plasma-dolphin.service if on KDE so it does not intercept FileManager1
      execFile('systemctl', ['--user', 'stop', 'plasma-dolphin.service'], { timeout: 2000 }, () => {})
      execFile('systemctl', ['--user', 'mask', 'plasma-dolphin.service'], { timeout: 2000 }, () => {})

      // Start the bridge in background
      try {
        const child = spawn(bridgeScript, [], { detached: true, stdio: 'ignore' })
        child.unref()
      } catch {}
    }

    return new Promise((resolve) => {
      execFile(
        'xdg-mime',
        ['default', 'max-file-manager.desktop', 'inode/directory'],
        { timeout: 5000 },
        (err) => {
          if (err) {
            resolve({ ok: false, error: err.message })
            return
          }
          execFile(
            'xdg-mime',
            ['default', 'max-file-manager.desktop', 'x-scheme-handler/file'],
            { timeout: 3000 },
            () => resolve({ ok: true })
          )
        }
      )
    })
  }
  return { ok: false, error: 'پشتیبانی فقط روی لینوکس فعال است' }
}
