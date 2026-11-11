import { nativeImage } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { freeName } from './ops.ts'

export type ConvertOpts = {
  format: 'jpeg' | 'png' | 'webp'
  /** longest side in pixels; 0 keeps the original size */
  maxSide: number
  /** 1..100, only for jpeg */
  quality: number
  /** write next to the source or into another folder */
  dest?: string
}

export type ConvertResult = { done: number; errors: string[]; outDir: string }

const isImage = (p: string) => /\.(png|jpe?g|webp|bmp|gif|avif)$/i.test(p)

/**
 * Batch image conversion. WebP is not encodable by Electron's nativeImage, so those files are
 * reported instead of being silently written in another format.
 */
export async function convertImages(files: string[], opts: ConvertOpts): Promise<ConvertResult> {
  const res: ConvertResult = { done: 0, errors: [], outDir: opts.dest ?? '' }
  if (opts.format === 'webp') {
    return { ...res, errors: ['خروجی WebP پشتیبانی نمی‌شود؛ JPEG یا PNG انتخاب کن'] }
  }
  for (const src of files) {
    if (!path.isAbsolute(src)) {
      res.errors.push(`${src}: مسیر نامعتبر`)
      continue
    }
    if (!isImage(src)) {
      res.errors.push(`${path.basename(src)}: تصویر نیست`)
      continue
    }
    try {
      const img = nativeImage.createFromPath(src)
      if (img.isEmpty()) throw new Error('تصویر خوانده نشد')
      const size = img.getSize()
      const out =
        opts.maxSide > 0 && Math.max(size.width, size.height) > opts.maxSide
          ? img.resize(
              size.width >= size.height
                ? { width: opts.maxSide, quality: 'best' }
                : { height: opts.maxSide, quality: 'best' }
            )
          : img
      const buf = opts.format === 'jpeg' ? out.toJPEG(Math.min(100, Math.max(1, opts.quality))) : out.toPNG()
      const dir = opts.dest && path.isAbsolute(opts.dest) ? opts.dest : path.dirname(src)
      await fs.mkdir(dir, { recursive: true })
      const base = path.basename(src, path.extname(src))
      const ext = opts.format === 'jpeg' ? '.jpg' : '.png'
      const target = await freeName(path.join(dir, `${base}${ext}`))
      await fs.writeFile(target, buf)
      res.done++
    } catch (e: any) {
      res.errors.push(`${path.basename(src)}: ${e?.message ?? String(e)}`)
    }
  }
  return res
}
