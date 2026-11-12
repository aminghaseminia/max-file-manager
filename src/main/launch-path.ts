import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The folder/file the app was asked to open.
 *
 * The desktop launcher runs `electron <appDir> %U`, so argv[1] is the app itself — the old code
 * treated it as the target and every double-clicked folder landed on the app directory. The first
 * argument is ignored only when it *is* the app path, so explicitly opening the app's own folder
 * still works through the second (real) argument.
 */
export function targetPath(argv: string[], appPath: string): string | null {
  const app = path.resolve(appPath)
  let skippedApp = false
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue
    let p: string | null = null
    if (arg.startsWith('file://')) {
      try {
        p = fileURLToPath(arg)
      } catch {
        continue
      }
    } else if (path.isAbsolute(arg)) {
      p = arg
    }
    if (!p) continue
    if (!skippedApp && path.resolve(p) === app) {
      skippedApp = true
      continue
    }
    return p
  }
  return null
}
