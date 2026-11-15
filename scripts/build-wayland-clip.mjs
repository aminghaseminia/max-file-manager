/**
 * Compiles the Wayland/Qt clipboard helper (src/main/wayland-clip/*.c) to out/main/wayland-clip
 * with the system gcc.
 *
 * Best effort by design, exactly like the Win+E hook: the helper only exists on Linux, a machine
 * without gcc or the Wayland client headers skips it, and file-copy-to-clipboard falls back to the
 * in-process path at runtime. Never fails the build.
 *
 * This lives in a script instead of the package.json "build" line because the shell form
 * (`2>/dev/null && … || true`) is POSIX-only: under cmd.exe on Windows it made `npm run build`
 * exit 1 even though the bundle was fine, which also blocked `npm run dist:win`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = path.join(root, 'src', 'main', 'wayland-clip')
const outDir = path.join(root, 'out', 'main')
const outFile = path.join(outDir, 'wayland-clip')

if (process.platform !== 'linux') {
  console.log('[wayland-clip] skipped: Linux only')
  process.exit(0)
}

const sources = [
  path.join(src, 'wayland-clip.c'),
  path.join(src, 'ext-data-control-v1-protocol.c'),
  path.join(src, 'wlr-data-control-unstable-v1-protocol.c')
].filter((f) => existsSync(f))

if (sources.length < 3) {
  console.log('[wayland-clip] skipped: protocol sources missing')
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })
try {
  execFileSync('gcc', ['-O2', '-Wall', ...sources, '-lwayland-client', '-o', outFile], {
    stdio: 'inherit'
  })
  execFileSync('strip', [outFile], { stdio: 'inherit' })
  console.log(`[wayland-clip] built ${path.relative(root, outFile)}`)
} catch (e) {
  // No gcc, no headers or no strip: the app still builds and the feature isn't promised.
  console.log('[wayland-clip] build failed, continuing without it:', e instanceof Error ? e.message : e)
}
