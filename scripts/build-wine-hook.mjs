/**
 * Compiles src/main/wine-hook/WinEHook.cs → out/main/WinEHook.exe with the csc.exe that ships
 * inside the .NET Framework (present on every Windows 10/11, no SDK required).
 *
 * Best effort by design, like the gcc step for the Wayland clipboard helper: a Linux/macOS build
 * skips it, and a Windows box without the Framework only loses the Win+E takeover, never the build.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const source = path.join(root, 'src', 'main', 'wine-hook', 'WinEHook.cs')
const outDir = path.join(root, 'out', 'main')
const outFile = path.join(outDir, 'WinEHook.exe')

if (process.platform !== 'win32') {
  console.log('[wine-hook] skipped: Windows only')
  process.exit(0)
}

const candidates = [
  process.env['MFM_CSC'],
  path.join(process.env['WINDIR'] ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(process.env['WINDIR'] ?? 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
].filter(Boolean)

const csc = candidates.find((c) => existsSync(c))
if (!csc) {
  console.log('[wine-hook] skipped: csc.exe not found (Win+E takeover stays unavailable)')
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })
try {
  execFileSync(
    csc,
    [
      '/nologo',
      '/target:winexe',
      '/platform:anycpu',
      '/optimize+',
      '/reference:System.Windows.Forms.dll',
      `/out:${outFile}`,
      source
    ],
    { stdio: 'inherit' }
  )
  console.log(`[wine-hook] built ${path.relative(root, outFile)}`)
} catch (e) {
  // The app must still build; the feature reports itself as unavailable at runtime.
  console.log('[wine-hook] compile failed, continuing without it:', e instanceof Error ? e.message : e)
}
