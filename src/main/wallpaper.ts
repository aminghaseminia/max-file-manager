import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isWallpaperExt, isWallpaperFillMode, type WallpaperFillMode } from '../shared/wallpaper.ts'

export {
  WALLPAPER_FILL_MODES,
  isWallpaperFillMode,
  type WallpaperFillMode
} from '../shared/wallpaper.ts'

const CMD = 'plasma-apply-wallpaperimage'

/** The renderer only offers the menu item for these, but main validates again. */
export const isWallpaperPath = (p: string): boolean =>
  path.isAbsolute(p) && isWallpaperExt(path.extname(p).slice(1))

/**
 * Without a fill mode the argv stays exactly what it was (`[image]`); with one it becomes
 * `['-f', mode, image]`. Exported so the tests can pin that contract without running Plasma.
 */
export const wallpaperArgs = (p: string, fillMode?: WallpaperFillMode): string[] =>
  fillMode ? ['-f', fillMode, p] : [p]

/**
 * KDE/Plasma only. The command is short-lived, so its exit code is awaited and a failure is
 * reported instead of vanishing. It is still detached with ignored stdio, so a slow session
 * cannot hold the app open.
 */
export async function setDesktopWallpaper(
  p: string,
  fillMode?: string
): Promise<{ ok: true } | { error: string }> {
  if (process.platform !== 'linux') {
    return { error: 'تنظیم پس‌زمینهٔ میزکار فقط در KDE/Plasma لینوکس پشتیبانی می‌شود' }
  }
  if (fillMode !== undefined && !isWallpaperFillMode(fillMode)) {
    return { error: 'حالت جاگیری تصویر نامعتبر است' }
  }
  if (!isWallpaperPath(p)) {
    return { error: 'فقط فایل تصویری (PNG، JPG، JPEG، WebP، BMP، GIF یا AVIF) می‌تواند پس‌زمینه شود' }
  }
  const st = await fs.stat(p).catch(() => null)
  if (!st?.isFile()) return { error: 'فایل تصویر پیدا نشد' }

  return new Promise((resolve) => {
    let settled = false
    const done = (r: { ok: true } | { error: string }): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    try {
      const child = spawn(CMD, wallpaperArgs(p, fillMode), { detached: true, stdio: 'ignore' })
      child.unref()
      child.once('error', (e: NodeJS.ErrnoException) => {
        done({
          error:
            e.code === 'ENOENT'
              ? 'ابزار KDE برای تنظیم پس‌زمینه پیدا نشد (plasma-apply-wallpaperimage)'
              : `اجرای ${CMD} ممکن نشد — ${e.message}`
        })
      })
      child.once('close', (code, signal) => {
        if (code === 0) return done({ ok: true })
        if (signal) return done({ error: `تنظیم پس‌زمینه با سیگنال ${signal} متوقف شد` })
        done({ error: `${CMD} با کد خروج ${code ?? 'نامعلوم'} تمام شد` })
      })
    } catch (e) {
      done({ error: `اجرای ${CMD} ممکن نشد — ${e instanceof Error ? e.message : String(e)}` })
    }
  })
}
