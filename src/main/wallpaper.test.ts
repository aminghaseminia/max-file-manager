import assert from 'node:assert/strict'
import test from 'node:test'
import { isWallpaperExt } from '../shared/wallpaper.ts'
import {
  WALLPAPER_FILL_MODES,
  isWallpaperFillMode,
  isWallpaperPath,
  setDesktopWallpaper,
  wallpaperArgs
} from './wallpaper.ts'

test('wallpaper extensions are exactly the formats Plasma accepts', () => {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif', 'PNG', '.JPG']) {
    assert.equal(isWallpaperExt(ext), true, ext)
  }
  for (const ext of ['svg', 'ico', 'tiff', 'pdf', 'txt', '']) {
    assert.equal(isWallpaperExt(ext), false, ext)
  }
})

test('a wallpaper path must be absolute and carry an accepted extension', () => {
  assert.equal(isWallpaperPath('/home/max/photo.webp'), true)
  assert.equal(isWallpaperPath('/home/max/photo.svg'), false)
  assert.equal(isWallpaperPath('photo.png'), false)
})

test('the fill modes are exactly the seven values Plasma accepts', () => {
  assert.deepEqual([...WALLPAPER_FILL_MODES], [
    'preserveAspectCrop',
    'stretch',
    'preserveAspectFit',
    'tile',
    'tileVertically',
    'tileHorizontally',
    'pad'
  ])
  for (const mode of WALLPAPER_FILL_MODES) assert.equal(isWallpaperFillMode(mode), true, mode)
})

test('every other fill-mode value is refused', () => {
  for (const bad of [
    'fill',
    'crop',
    'cover',
    'PreserveAspectCrop',
    'preserveAspectCrop; rm -rf /',
    'preserveAspectCrop stretch',
    ' pad',
    'pad ',
    'tile;',
    '',
    null,
    undefined,
    1,
    {}
  ]) {
    assert.equal(isWallpaperFillMode(bad), false, String(bad))
  }
})

test('a valid mode is passed as -f and no mode keeps the old argv', () => {
  const p = '/home/max/photo.png'
  for (const mode of WALLPAPER_FILL_MODES) {
    assert.deepEqual(wallpaperArgs(p, mode), ['-f', mode, p], mode)
  }
  assert.deepEqual(wallpaperArgs(p), [p])
})

test('an invalid fill mode is refused before Plasma is called', async () => {
  if (process.platform !== 'linux') return
  const r = await setDesktopWallpaper('/definitely/not/here/mfm-wallpaper.png', 'tile; rm -rf /')
  assert.deepEqual(r, { error: 'حالت جاگیری تصویر نامعتبر است' })
})

test('a missing image is refused before Plasma is called', async () => {
  if (process.platform !== 'linux') return
  const r = await setDesktopWallpaper('/definitely/not/here/mfm-wallpaper.png')
  assert.deepEqual(r, { error: 'فایل تصویر پیدا نشد' })
})
