import { execFile } from 'node:child_process'
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
