/**
 * App icons for the «Open with» sheet.
 *
 * Electron can read a bundle's icon itself (`app.getFileIcon`), which is the only reasonable API
 * on macOS: a `.app` ships an `.icns`, and Chromium cannot render that container. The PNG is
 * cached under userData keyed by the bundle path **and its mtime**, so updating an app changes the
 * key and the stale icon is never shown.
 */
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

const cacheDir = (): string => path.join(app.getPath('userData'), 'appicons')

/** Absolute PNG path the renderer can load through `mfm://`, or '' when no icon is available. */
export async function appIconFile(target: string): Promise<string> {
  const st = await fs.stat(target).catch(() => null)
  if (!st) return ''
  const key = createHash('sha1').update(`${target}:${st.mtimeMs}`).digest('hex')
  const file = path.join(cacheDir(), `${key}.png`)
  const exists = await fs.access(file).then(() => true, () => false)
  if (exists) return file

  const img = await app.getFileIcon(target, { size: 'normal' }).catch(() => null)
  if (!img || img.isEmpty()) return ''

  await fs.mkdir(cacheDir(), { recursive: true }).catch(() => undefined)
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, img.toPNG()).catch(() => undefined)
  await fs.rename(tmp, file).catch(() => undefined)
  return (await fs.access(file).then(() => true, () => false)) ? file : ''
}
