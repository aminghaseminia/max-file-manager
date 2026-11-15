import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type MemoryInfo = {
  total: number
  available: number
  used: number
  swapTotal: number
  swapFree: number
  swapUsed: number
}

type ParsedMemory = Omit<MemoryInfo, 'used' | 'swapUsed'>

const UNIT_BYTES: Record<string, number> = {
  '': 1,
  B: 1,
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4
}

function bytesFromMatch(text: string, key: string): number | null {
  const m = new RegExp(`${key}\\s*=\\s*([\\d.]+)\\s*([BKMGT]?)`, 'i').exec(text)
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value)) return null
  return Math.round(value * (UNIT_BYTES[m[2].toUpperCase()] ?? 1))
}

/** Pure parser for Linux `/proc/meminfo`; exported for tests. */
export function parseMeminfo(text: string): ParsedMemory | null {
  if (!text.trim()) return null
  const kb = new Map<string, number>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_()]+):\s*(\d+)(?:\s+kB)?\s*$/.exec(line.trim())
    if (m) kb.set(m[1], Number(m[2]))
  }
  if (!kb.has('MemTotal')) return null
  const get = (key: string): number => (kb.get(key) ?? 0) * 1024
  // MemAvailable is the kernel's best estimate of memory a new workload can use. Older kernels
  // lack it; the classic free+buffers+cached approximation is the fallback.
  const available = kb.has('MemAvailable')
    ? get('MemAvailable')
    : Math.max(0, get('MemFree') + get('Buffers') + get('Cached') + get('SReclaimable') - get('Shmem'))
  return {
    total: get('MemTotal'),
    available,
    swapTotal: get('SwapTotal'),
    swapFree: get('SwapFree')
  }
}

/** Parses macOS `sysctl -n vm.swapusage` output. */
export function parseMacSwap(text: string): { total: number; free: number } | null {
  const total = bytesFromMatch(text, 'total')
  const free = bytesFromMatch(text, 'free')
  return total === null || free === null ? null : { total, free }
}

async function macSwap(): Promise<{ total: number; free: number }> {
  try {
    const { stdout } = await execFileAsync('sysctl', ['-n', 'vm.swapusage'], { timeout: 3000 })
    return parseMacSwap(stdout) ?? { total: 0, free: 0 }
  } catch {
    return { total: 0, free: 0 }
  }
}

async function windowsSwap(): Promise<{ total: number; free: number }> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$p=Get-CimInstance Win32_PageFileUsage; if($p){$t=($p|Measure-Object -Property AllocatedBaseSize -Sum).Sum; $u=($p|Measure-Object -Property CurrentUsage -Sum).Sum; [pscustomobject]@{total=$t;used=$u}|ConvertTo-Json -Compress}'
      ],
      { timeout: 5000 }
    )
    const row = JSON.parse(stdout.trim() || '{}') as { total?: number; used?: number }
    const totalMb = Number(row.total)
    const usedMb = Number(row.used)
    if (!Number.isFinite(totalMb) || totalMb <= 0) return { total: 0, free: 0 }
    const total = totalMb * 1024 ** 2
    const used = Math.min(total, Math.max(0, (Number.isFinite(usedMb) ? usedMb : 0) * 1024 ** 2))
    return { total, free: Math.max(0, total - used) }
  } catch {
    return { total: 0, free: 0 }
  }
}

/** Live physical-memory and swap figures for the system content page. */
export async function memoryInfo(): Promise<MemoryInfo> {
  let base: ParsedMemory | null = null
  let swap: { total: number; free: number } | null = null

  if (process.platform === 'linux') {
    const text = await fs.readFile('/proc/meminfo', 'utf8').catch(() => '')
    base = parseMeminfo(text)
    if (base) swap = { total: base.swapTotal, free: base.swapFree }
  } else if (process.platform === 'darwin') {
    swap = await macSwap()
  } else if (process.platform === 'win32') {
    swap = await windowsSwap()
  }

  if (!base) {
    const total = os.totalmem()
    const available = Math.min(total, os.freemem())
    base = { total, available, swapTotal: swap?.total ?? 0, swapFree: swap?.free ?? 0 }
  }
  if (swap) {
    base.swapTotal = swap.total
    base.swapFree = swap.free
  }
  return {
    ...base,
    used: Math.max(0, base.total - base.available),
    swapUsed: Math.max(0, base.swapTotal - base.swapFree)
  }
}
