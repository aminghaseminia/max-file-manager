import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { dbusExecQuote, updatePortalsConf } from './portal-core.ts'

const exec = promisify(execFile)
export const PORTAL_BUS_NAME = 'org.freedesktop.impl.portal.desktop.mfm'

function locations() {
  const home = os.homedir()
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config')
  const dataHome = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share')
  return {
    config: path.join(configHome, 'xdg-desktop-portal', 'portals.conf'),
    descriptor: path.join(dataHome, 'xdg-desktop-portal', 'portals', 'mfm.portal'),
    service: path.join(dataHome, 'dbus-1', 'services', `${PORTAL_BUS_NAME}.service`)
  }
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, text, { mode: 0o644 })
  await fs.rename(tmp, file)
}

function backendCommand(): string[] {
  // APPIMAGE is the outer executable; process.execPath inside it points into the mounted runtime.
  const executable = process.env.APPIMAGE || process.execPath
  const args = [executable]
  if (!app.isPackaged) args.push(app.getAppPath())
  args.push('--portal-backend')
  return args
}

async function restartFrontend(): Promise<void> {
  await exec('systemctl', ['--user', 'restart', 'xdg-desktop-portal.service'], { timeout: 30_000 })
}

export function portalInstalled(): boolean {
  const p = locations()
  return existsSync(p.descriptor) && existsSync(p.service)
}

/** Installs only per-user files. Existing portal preferences and other backends are preserved. */
export async function installPortal(): Promise<void> {
  if (process.platform !== 'linux') throw new Error('The XDG file picker is available on Linux only')
  const p = locations()
  const previous = await fs.readFile(p.config, 'utf8').catch(() => '')
  const config = updatePortalsConf(previous, true)
  await writeAtomic(
    p.descriptor,
    `[portal]\nDBusName=${PORTAL_BUS_NAME}\nInterfaces=org.freedesktop.impl.portal.FileChooser;\n`
  )
  await writeAtomic(
    p.service,
    `[D-BUS Service]\nName=${PORTAL_BUS_NAME}\nExec=${backendCommand().map(dbusExecQuote).join(' ')}\n`
  )
  await writeAtomic(p.config, config)
  await restartFrontend()
}

export async function uninstallPortal(): Promise<void> {
  if (process.platform !== 'linux') return
  const p = locations()
  const previous = await fs.readFile(p.config, 'utf8').catch(() => '')
  await Promise.all([fs.unlink(p.descriptor).catch(() => undefined), fs.unlink(p.service).catch(() => undefined)])
  const config = updatePortalsConf(previous, false)
  // Do not leave an empty file that MFM created; a non-empty file may still contain user settings.
  if (config.trim()) await writeAtomic(p.config, config)
  else await fs.unlink(p.config).catch(() => undefined)
  await restartFrontend()
}
