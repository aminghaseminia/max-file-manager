/**
 * App icons for the «Open with» sheet.
 *
 * `app.getFileIcon()` returns a **generic square** for `.app` bundles on current macOS (checked
 * against Xcode, Chrome and Notes), so the icon is taken from the bundle itself: `Info.plist`
 * names a `.icns`, and `sips` (a fixed system tool) converts it to a small PNG. Bundles that ship
 * no `.icns` (asset-catalog-only apps) get no icon and the UI keeps its line glyph — better than a
 * blank square that looks like a broken image.
 *
 * The PNG is cached under userData keyed by the bundle path, its mtime and a format version, so an
 * app update — or this implementation changing — invalidates the cache.
 */
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import path from 'node:path'

const ICON_VERSION = 'v2'

const exists = (p: string): Promise<boolean> => fs.access(p).then(() => true, () => false)

const run = (cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, maxBuffer: 1024 * 1024 }, (err, out) =>
      resolve({ ok: !err, out: String(out ?? '') })
    )
  })

/** The bundle's own `.icns`: what `CFBundleIconFile` names, else any icon the bundle carries. */
async function bundleIcon(bundle: string): Promise<string> {
  const res = path.join(bundle, 'Contents', 'Resources')
  const named = (
    await run('plutil', [
      '-extract',
      'CFBundleIconFile',
      'raw',
      '-o',
      '-',
      path.join(bundle, 'Contents', 'Info.plist')
    ])
  ).out.trim()
  if (named) {
    const file = path.join(res, named.endsWith('.icns') ? named : `${named}.icns`)
    if (await exists(file)) return file
  }
  const all = await fs.readdir(res).catch(() => [] as string[])
  const icns = all.filter((f) => f.toLowerCase().endsWith('.icns'))
  if (!icns.length) return ''
  const wanted = path.basename(bundle, '.app').toLowerCase()
  return path.join(res, icns.find((f) => f.toLowerCase().startsWith(wanted)) ?? icns[0])
}

/**
 * Absolute PNG path the renderer can load through `mfm://`, or '' when the app has no icon.
 * `dir` is the cache folder (userData/appicons); it is a parameter so this module stays free of
 * `electron` and can be checked with `node --test`.
 */
export async function appIconFile(bundle: string, dir: string): Promise<string> {
  const st = await fs.stat(bundle).catch(() => null)
  if (!st || !bundle.endsWith('.app')) return ''
  const key = createHash('sha1')
    .update(`${ICON_VERSION}:${bundle}:${st.mtimeMs}`)
    .digest('hex')
  const file = path.join(dir, `${key}.png`)
  if (await exists(file)) return file

  const icns = await bundleIcon(bundle)
  if (!icns) return ''
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
  const tmp = `${file}.${process.pid}.png`
  const made = await run('sips', ['-s', 'format', 'png', '-Z', '64', icns, '--out', tmp])
  if (!made.ok || !(await exists(tmp))) {
    await fs.unlink(tmp).catch(() => undefined)
    return ''
  }
  await fs.rename(tmp, file).catch(() => undefined)
  return (await exists(file)) ? file : ''
}
