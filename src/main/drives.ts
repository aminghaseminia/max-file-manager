import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type Drive = {
  id: string
  name: string
  device: string
  mountpoint: string | null
  size: string
  fsType: string
  removable: boolean
  mounted: boolean
}

type LsblkNode = {
  name: string
  label: string | null
  mountpoint: string | null
  rm?: boolean | number
  hotplug?: boolean | number
  size?: string
  type?: string
  fstype?: string | null
  model?: string | null
  vendor?: string | null
  tran?: string | null
  children?: LsblkNode[]
}

/** Parses lsblk JSON output to extract removable/USB block devices. Pure function for testability. */
export function parseLsblkOutput(jsonStr: string): Drive[] {
  if (!jsonStr || !jsonStr.trim()) return []
  let data: { blockdevices?: LsblkNode[] }
  try {
    data = JSON.parse(jsonStr)
  } catch {
    return []
  }
  const rootDevices = data.blockdevices ?? []
  const out: Drive[] = []

  for (const dev of rootDevices) {
    const isUsb = dev.tran === 'usb'
    const isRemovable = Boolean(dev.rm) || Boolean(dev.hotplug) || isUsb

    // If this device or its children are removable/USB:
    if (!isRemovable && dev.type !== 'part') {
      // Check if any child is mounted under /media or /run/media
      const hasMediaChild = dev.children?.some(
        (c) => c.mountpoint?.startsWith('/media') || c.mountpoint?.startsWith('/run/media')
      )
      if (!hasMediaChild) continue
    }

    const modelName = (dev.model ?? dev.vendor ?? '').trim()

    if (dev.children && dev.children.length > 0) {
      for (const child of dev.children) {
        // Skip swap, extended, or empty crypto containers
        if (child.fstype === 'swap' || child.type === 'crypto_LUKS') continue
        // Must be a partition or disk or loop with a filesystem
        const devName = child.name.startsWith('/') ? child.name : `/dev/${child.name}`
        const label = child.label?.trim()
        const sizeStr = child.size?.trim() || ''
        const displayName =
          label || (modelName ? `${modelName}${sizeStr ? ` (${sizeStr})` : ''}` : `USB ${child.name}${sizeStr ? ` (${sizeStr})` : ''}`)

        out.push({
          id: child.name,
          name: displayName,
          device: devName,
          mountpoint: child.mountpoint || null,
          size: sizeStr,
          fsType: child.fstype || '',
          removable: true,
          mounted: Boolean(child.mountpoint)
        })
      }
    } else if (dev.fstype || dev.type === 'disk' || isRemovable) {
      // Whole disk format without partition table (or unpartitioned flash)
      if (dev.fstype === 'swap') continue
      const devName = dev.name.startsWith('/') ? dev.name : `/dev/${dev.name}`
      const label = dev.label?.trim()
      const sizeStr = dev.size?.trim() || ''
      const displayName =
        label || (modelName ? `${modelName}${sizeStr ? ` (${sizeStr})` : ''}` : `USB ${dev.name}${sizeStr ? ` (${sizeStr})` : ''}`)

      out.push({
        id: dev.name,
        name: displayName,
        device: devName,
        mountpoint: dev.mountpoint || null,
        size: sizeStr,
        fsType: dev.fstype || '',
        removable: true,
        mounted: Boolean(dev.mountpoint)
      })
    }
  }

  return out
}

/** Lists connected removable / USB drives using lsblk on Linux. */
export async function listDrives(): Promise<Drive[]> {
  if (process.platform !== 'linux') return []
  try {
    const { stdout } = await execFileAsync(
      'lsblk',
      ['-J', '-o', 'NAME,LABEL,MOUNTPOINT,RM,HOTPLUG,SIZE,TYPE,FSTYPE,MODEL,VENDOR,TRAN'],
      { timeout: 3000 }
    )
    return parseLsblkOutput(stdout)
  } catch (err) {
    return []
  }
}

const DEV_PATH_RE = /^\/dev\/[a-zA-Z0-9_\-]+$/

/** Mounts a block device (e.g. /dev/sdb1) using udisksctl as user without sudo. */
export async function mountDrive(device: string): Promise<{ ok: boolean; mountpoint?: string; error?: string }> {
  if (process.platform !== 'linux') return { ok: false, error: 'تنها در لینوکس پشتیبانی می‌شود' }
  const cleanDev = device.trim()
  if (!DEV_PATH_RE.test(cleanDev)) {
    return { ok: false, error: 'مسیر دیسک نامعتبر است' }
  }

  try {
    const { stdout } = await execFileAsync('udisksctl', ['mount', '-b', cleanDev, '--no-user-interaction'], {
      timeout: 10000
    })
    // Output: "Mounted /dev/sdb1 at /run/media/user/LABEL."
    const match = /at\s+([^\r\n.]+)/i.exec(stdout)
    const mountpoint = match ? match[1].trim() : undefined
    return { ok: true, mountpoint }
  } catch (err: any) {
    const msg = err?.stderr || err?.message || String(err)
    if (msg.includes('AlreadyMounted') || msg.includes('already mounted')) {
      // Find current mountpoint
      const drives = await listDrives()
      const found = drives.find((d) => d.device === cleanDev)
      return { ok: true, mountpoint: found?.mountpoint ?? undefined }
    }
    return { ok: false, error: msg.replace(/udisks-error-quark[,\s\d]*/gi, '').trim() }
  }
}

/** Unmounts a block device or mountpoint using udisksctl. */
export async function unmountDrive(deviceOrMount: string): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'linux') return { ok: false, error: 'تنها در لینوکس پشتیبانی می‌شود' }
  let target = deviceOrMount.trim()

  // If given a mountpoint, check if it maps to a known block device
  if (target.startsWith('/') && !target.startsWith('/dev/')) {
    const drives = await listDrives()
    const match = drives.find((d) => d.mountpoint === target)
    if (match) target = match.device
  }

  if (!DEV_PATH_RE.test(target)) {
    return { ok: false, error: 'مسیر دیسک نامعتبر است' }
  }

  try {
    await execFileAsync('udisksctl', ['unmount', '-b', target, '--no-user-interaction'], {
      timeout: 10000
    })
    return { ok: true }
  } catch (err: any) {
    const msg = err?.stderr || err?.message || String(err)
    return { ok: false, error: msg.replace(/udisks-error-quark[,\s\d]*/gi, '').trim() }
  }
}


/** A filesystem/volume shown on the «This PC» page. Sizes are bytes. */
export type DiskVolume = {
  id: string
  name: string
  device: string
  mountpoint: string | null
  fsType: string
  total: number
  free: number | null
  used: number | null
  removable: boolean
  mounted: boolean
  system: boolean
}

const VOLUME_SKIP_FS = new Set(['swap', 'crypto_LUKS', 'linux_raid_member', 'zfs_member'])

const bytesOf = (value: string | number | undefined): number => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Flattens `lsblk --json --bytes` into mounted volumes plus removable media that is not mounted
 * yet. Internal unmounted partitions are intentionally left out: Windows also does not put the
 * EFI/recovery system partitions on its «This PC» page.
 */
export function parseLsblkVolumes(jsonStr: string): DiskVolume[] {
  if (!jsonStr || !jsonStr.trim()) return []
  let data: { blockdevices?: LsblkNode[] }
  try {
    data = JSON.parse(jsonStr)
  } catch {
    return []
  }

  const byDevice = new Map<string, DiskVolume>()
  const visit = (node: LsblkNode, parentModel: string, parentRemovable: boolean): void => {
    const model = (node.model ?? node.vendor ?? parentModel ?? '').trim()
    const removable =
      parentRemovable || Boolean(node.rm) || Boolean(node.hotplug) || node.tran === 'usb'
    const fsType = (node.fstype ?? '').trim()
    const mountpoint = node.mountpoint?.trim() || null
    const pseudo = node.type === 'loop' || node.type === 'ram' || /^(loop|ram|zram)/.test(node.name)
    const mountable = !!fsType && !VOLUME_SKIP_FS.has(fsType) && !pseudo
    // A mounted filesystem is always useful. An unmounted one only appears when it is removable,
    // so the page can offer «Mount» without drowning the user in internal recovery partitions.
    if (mountable && (mountpoint || removable)) {
      const device = node.name.startsWith('/') ? node.name : `/dev/${node.name}`
      const label = (node.label ?? '').trim()
      const mountName = mountpoint
        ? mountpoint === '/'
          ? 'System'
          : path.posix.basename(mountpoint) || mountpoint
        : ''
      const name = label || mountName || model || device
      const volume: DiskVolume = {
        id: device,
        name,
        device,
        mountpoint,
        fsType,
        total: bytesOf(node.size),
        free: null,
        used: null,
        removable,
        mounted: !!mountpoint,
        system: mountpoint === '/'
      }
      const existing = byDevice.get(device)
      // A Btrfs device can expose several subvolumes; keep the root one for the summary.
      if (
        !existing ||
        (!existing.mountpoint && mountpoint) ||
        (mountpoint === '/' && existing.mountpoint !== '/')
      ) {
        byDevice.set(device, volume)
      }
    }
    for (const child of node.children ?? []) visit(child, model || parentModel, removable)
  }

  for (const dev of data.blockdevices ?? []) visit(dev, '', false)
  return [...byDevice.values()]
}

type WindowsDiskRow = {
  DeviceID?: unknown
  VolumeName?: unknown
  Size?: unknown
  FreeSpace?: unknown
  DriveType?: unknown
  FileSystem?: unknown
}

/** Parses the JSON from `Get-CimInstance Win32_LogicalDisk`. */
export function parseWindowsVolumes(jsonStr: string): DiskVolume[] {
  if (!jsonStr || !jsonStr.trim()) return []
  let data: unknown
  try {
    data = JSON.parse(jsonStr)
  } catch {
    return []
  }
  const rows = Array.isArray(data) ? data : [data]
  const systemDrive = (process.env.SystemDrive || 'C:').toUpperCase()
  const out: DiskVolume[] = []
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue
    const row = item as WindowsDiskRow
    const device = String(row.DeviceID ?? '').trim()
    if (!/^[A-Za-z]:$/.test(device)) continue
    const total = bytesOf(row.Size as string | number | undefined)
    const freeRaw = Number(row.FreeSpace)
    const free = Number.isFinite(freeRaw) ? Math.max(0, freeRaw) : null
    const driveType = Number(row.DriveType)
    out.push({
      id: device.toUpperCase(),
      name: String(row.VolumeName ?? '').trim() || device,
      device: device.toUpperCase(),
      mountpoint: `${device.toUpperCase()}\\`,
      fsType: String(row.FileSystem ?? '').trim(),
      total,
      free,
      used: free === null ? null : Math.max(0, total - free),
      removable: driveType === 2,
      mounted: true,
      system: device.toUpperCase() === systemDrive
    })
  }
  return out
}

async function withUsage(volumes: DiskVolume[]): Promise<DiskVolume[]> {
  return Promise.all(
    volumes.map(async (v) => {
      if (!v.mounted || !v.mountpoint) return v
      const st = await fs.statfs(v.mountpoint).catch(() => null)
      if (!st) return v
      const total = Number(st.blocks) * Number(st.bsize)
      const free = Number(st.bavail) * Number(st.bsize)
      return {
        ...v,
        total: total || v.total,
        free: Number.isFinite(free) ? free : null,
        used: Number.isFinite(free) && total > 0 ? Math.max(0, total - free) : null
      }
    })
  )
}

/** Fallback for systems where the block-device inventory is unavailable. */
async function mountedPathVolumes(paths: string[]): Promise<DiskVolume[]> {
  const out: DiskVolume[] = []
  const seen = new Set<string>()
  for (const root of paths) {
    const st = await fs.statfs(root).catch(() => null)
    if (!st) continue
    const total = Number(st.blocks) * Number(st.bsize)
    const free = Number(st.bavail) * Number(st.bsize)
    // Several candidate paths can point at the same filesystem (/, home, …). The statfs identity
    // is enough to collapse those duplicates for this fallback view.
    const key = `${Number(st.type)}:${Number(st.blocks)}:${Number(st.bfree)}:${Number(st.bavail)}`
    const cleanPath = path.resolve(root)
    if (seen.has(key)) continue
    seen.add(key)
    const system = cleanPath === '/'
    out.push({
      id: cleanPath,
      name: system ? 'System' : path.basename(cleanPath) || cleanPath,
      device: cleanPath,
      mountpoint: cleanPath,
      fsType: '',
      total,
      free,
      used: Math.max(0, total - free),
      removable: cleanPath !== '/',
      mounted: true,
      system
    })
  }
  return out
}

async function linuxVolumes(): Promise<DiskVolume[]> {
  try {
    const { stdout } = await execFileAsync(
      'lsblk',
      ['-J', '-b', '-o', 'NAME,LABEL,MOUNTPOINT,RM,HOTPLUG,SIZE,TYPE,FSTYPE,MODEL,VENDOR,TRAN'],
      { timeout: 5000 }
    )
    const found = parseLsblkVolumes(stdout)
    if (found.length) return found
  } catch {
    // fall through to the mount-point fallback
  }
  const user = os.userInfo().username
  const roots = ['/', os.homedir(), `/media/${user}`, `/run/media/${user}`, '/mnt']
  const extra: string[] = []
  for (const base of ['/mnt', `/media/${user}`, `/run/media/${user}`]) {
    const kids = await fs.readdir(base, { withFileTypes: true }).catch(() => [])
    for (const k of kids) if (k.isDirectory()) extra.push(path.join(base, k.name))
  }
  return mountedPathVolumes([...roots, ...extra])
}

async function windowsVolumes(): Promise<DiskVolume[]> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,Size,FreeSpace,DriveType,FileSystem | ConvertTo-Json -Compress'
      ],
      { timeout: 5000 }
    )
    const found = parseWindowsVolumes(stdout)
    if (found.length) return found
  } catch {
    // fall through to the drive-letter fallback
  }
  const letters: string[] = []
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`
    if (await fs.stat(root).catch(() => null)) letters.push(root)
  }
  return mountedPathVolumes(letters)
}

/** All mounted filesystems and removable disks, with live capacity figures. */
export async function listVolumes(): Promise<DiskVolume[]> {
  let found: DiskVolume[] = []
  if (process.platform === 'linux') found = await linuxVolumes()
  else if (process.platform === 'win32') found = await windowsVolumes()
  else {
    const paths = ['/']
    if (process.platform === 'darwin') {
      const kids = await fs.readdir('/Volumes', { withFileTypes: true }).catch(() => [])
      for (const k of kids) if (k.isDirectory()) paths.push(path.join('/Volumes', k.name))
    }
    found = await mountedPathVolumes(paths)
  }
  return withUsage(found)
}
