import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLsblkOutput } from './drives.ts'

test('parseLsblkOutput: empty or invalid string returns []', () => {
  assert.deepEqual(parseLsblkOutput(''), [])
  assert.deepEqual(parseLsblkOutput('not-json'), [])
  assert.deepEqual(parseLsblkOutput('{}'), [])
})

test('parseLsblkOutput: skips internal non-removable NVMe disks', () => {
  const json = JSON.stringify({
    blockdevices: [
      {
        name: 'nvme0n1',
        label: null,
        mountpoint: null,
        rm: false,
        hotplug: false,
        size: '1.9T',
        type: 'disk',
        fstype: null,
        model: 'Lexar SSD NM620 2TB',
        tran: 'nvme',
        children: [
          {
            name: 'nvme0n1p1',
            label: null,
            mountpoint: '/',
            rm: false,
            hotplug: false,
            size: '306G',
            type: 'part',
            fstype: 'ext4'
          }
        ]
      }
    ]
  })

  const res = parseLsblkOutput(json)
  assert.deepEqual(res, [])
})

test('parseLsblkOutput: identifies USB removable drives and partitions', () => {
  const json = JSON.stringify({
    blockdevices: [
      {
        name: 'sdb',
        label: null,
        mountpoint: null,
        rm: true,
        hotplug: true,
        size: '14.9G',
        type: 'disk',
        fstype: null,
        model: 'Ultra USB 3.0',
        vendor: 'SanDisk',
        tran: 'usb',
        children: [
          {
            name: 'sdb1',
            label: 'MY_FLASH',
            mountpoint: '/run/media/maxv/MY_FLASH',
            rm: true,
            hotplug: true,
            size: '14.9G',
            type: 'part',
            fstype: 'vfat'
          }
        ]
      },
      {
        name: 'sdc',
        label: null,
        mountpoint: null,
        rm: true,
        hotplug: false,
        size: '32G',
        type: 'disk',
        fstype: null,
        model: 'Kingston DataTraveler',
        tran: 'usb',
        children: [
          {
            name: 'sdc1',
            label: null,
            mountpoint: null,
            rm: true,
            hotplug: false,
            size: '32G',
            type: 'part',
            fstype: 'ntfs'
          }
        ]
      }
    ]
  })

  const res = parseLsblkOutput(json)
  assert.equal(res.length, 2)

  assert.equal(res[0].id, 'sdb1')
  assert.equal(res[0].name, 'MY_FLASH')
  assert.equal(res[0].device, '/dev/sdb1')
  assert.equal(res[0].mountpoint, '/run/media/maxv/MY_FLASH')
  assert.equal(res[0].mounted, true)
  assert.equal(res[0].fsType, 'vfat')

  assert.equal(res[1].id, 'sdc1')
  assert.equal(res[1].name, 'Kingston DataTraveler (32G)')
  assert.equal(res[1].device, '/dev/sdc1')
  assert.equal(res[1].mountpoint, null)
  assert.equal(res[1].mounted, false)
  assert.equal(res[1].fsType, 'ntfs')
})

test('parseLsblkOutput: unpartitioned single-filesystem USB stick', () => {
  const json = JSON.stringify({
    blockdevices: [
      {
        name: 'sdd',
        label: 'BACKUP',
        mountpoint: null,
        rm: true,
        hotplug: true,
        size: '64G',
        type: 'disk',
        fstype: 'exfat',
        model: 'Cruzer Blade',
        tran: 'usb'
      }
    ]
  })

  const res = parseLsblkOutput(json)
  assert.equal(res.length, 1)
  assert.equal(res[0].name, 'BACKUP')
  assert.equal(res[0].device, '/dev/sdd')
  assert.equal(res[0].mounted, false)
  assert.equal(res[0].fsType, 'exfat')
})
