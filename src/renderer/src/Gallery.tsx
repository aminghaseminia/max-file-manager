import { t } from './i18n.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Entry } from './api'
import { fa, mediaUrl } from './format'
import { copyImageContent } from './clipboard'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ConfirmIcon,
  CopyIcon,
  DupeIcon,
  MaximizeIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RestoreIcon,
  RotateIcon,
  SplitIcon,
  StarIcon,
  XIcon
} from './Icons'

type Props = {
  /** images of the current folder, in the order the pane shows them */
  images: Entry[]
  startPath: string
  fullscreen: boolean
  onClose(): void
  onFullscreen(): void
  onSaved(msg: string): void
  onChanged(): void
  slideshowSec: number
  loop: boolean
  imageFormat: ImageFormat
  imageQuality: number
}

export type ImageFormat = 'png' | 'jpeg' | 'webp'

const MIME: Record<ImageFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }

/** A file keeps its own container: overwriting a .png with jpeg bytes would be a lie. */
const formatOf = (p: string): ImageFormat =>
  /\.(jpe?g)$/i.test(p) ? 'jpeg' : /\.webp$/i.test(p) ? 'webp' : 'png'

const encode = (c: HTMLCanvasElement, fmt: ImageFormat, quality: number): string =>
  c.toDataURL(MIME[fmt], fmt === 'png' ? undefined : Math.min(100, Math.max(50, quality)) / 100)

type Edit = { url: string; w: number; h: number }
type Rect = { x: number; y: number; w: number; h: number }

/** Full-window photo viewer with everyday edits: rotate, flip, crop, resize, save. */
export function Gallery({
  images,
  startPath,
  fullscreen,
  slideshowSec,
  loop,
  imageFormat,
  imageQuality,
  onClose,
  onFullscreen,
  onSaved,
  onChanged
}: Props) {
  const start = Math.max(0, images.findIndex((i) => i.path === startPath))
  const [at, setAt] = useState(start)
  const [zoom, setZoom] = useState(1)
  const [rot, setRot] = useState(0)
  const [fit, setFit] = useState(true)
  const [slide, setSlide] = useState(false)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [crop, setCrop] = useState<Rect | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [cropping, setCropping] = useState(false)
  const [resize, setResize] = useState<{ w: number; h: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const activeThumb = useRef<HTMLButtonElement | null>(null)
  const copyRef = useRef<() => void>(() => {})

  const total = images.length
  const cur = images[Math.min(at, total - 1)]
  // every image is reachable; a huge folder keeps a 2000-thumb window around the active one
  const STRIP_CAP = 2000
  const stripFrom = total > STRIP_CAP ? Math.min(Math.max(at - STRIP_CAP / 2, 0), total - STRIP_CAP) : 0
  const strip = useMemo(
    () => images.slice(stripFrom, stripFrom + STRIP_CAP),
    [images, stripFrom]
  )

  useEffect(() => {
    // `scrollIntoView` handles the RTL strip correctly (scrollLeft is negative there)
    activeThumb.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' })
  }, [at, strip.length])

  const resetView = () => {
    setZoom(1)
    setRot(0)
    setFit(true)
  }

  const go = (d: number) => {
    setAt((i) => {
      if (!total) return 0
      const next = i + d
      // with loop off the strip stops at the ends instead of wrapping
      return loop ? (next + total) % total : Math.min(total - 1, Math.max(0, next))
    })
    setEdit(null)
    setCrop(null)
    setCropping(false)
    resetView()
  }

  useEffect(() => {
    if (!slide || total < 2) return
    const timer = setInterval(() => go(1), Math.max(1, slideshowSec) * 1000)
    return () => clearInterval(timer)
  }, [slide, total, slideshowSec])

  /** Every edit runs on a canvas at full resolution, so no step loses pixels. */
  const loadCanvas = async (): Promise<HTMLCanvasElement | null> => {
    if (!cur) return null
    // mfm:// taints a canvas, so editing runs on the file bytes as a data: URL instead
    let src = edit?.url
    if (!src) {
      const r = await api.imageData(cur.path)
      if (!r.dataUrl) {
        onSaved(r.error ?? t('تصویر بارگذاری نشد'))
        return null
      }
      src = r.dataUrl
    }
    const img = new Image()
    img.src = src
    try {
      await img.decode()
    } catch {
      return null
    }
    const c = document.createElement('canvas')
    c.width = edit?.w ?? img.naturalWidth
    c.height = edit?.h ?? img.naturalHeight
    c.getContext('2d')!.drawImage(img, 0, 0)
    return c
  }

  const commit = (c: HTMLCanvasElement) => {
    // the working copy stays in the file's own format so an overwrite is always safe
    setEdit({ url: encode(c, cur ? formatOf(cur.path) : 'png', imageQuality), w: c.width, h: c.height })
    setCrop(null)
    resetView()
  }

  const rotate = async (dir: 1 | -1) => {
    const c = await loadCanvas()
    if (!c) return
    const out = document.createElement('canvas')
    out.width = c.height
    out.height = c.width
    const ctx = out.getContext('2d')!
    ctx.translate(out.width / 2, out.height / 2)
    ctx.rotate((dir * Math.PI) / 2)
    ctx.drawImage(c, -c.width / 2, -c.height / 2)
    commit(out)
  }

  const flip = async (axis: 'x' | 'y') => {
    const c = await loadCanvas()
    if (!c) return
    const out = document.createElement('canvas')
    out.width = c.width
    out.height = c.height
    const ctx = out.getContext('2d')!
    ctx.translate(axis === 'x' ? out.width : 0, axis === 'y' ? out.height : 0)
    ctx.scale(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1)
    ctx.drawImage(c, 0, 0)
    commit(out)
  }

  const applyCrop = async () => {
    const c = await loadCanvas()
    if (!c || !crop || crop.w <= 0 || crop.h <= 0) return
    const sx = Math.round(crop.x * c.width)
    const sy = Math.round(crop.y * c.height)
    const sw = Math.max(1, Math.round(crop.w * c.width))
    const sh = Math.max(1, Math.round(crop.h * c.height))
    const out = document.createElement('canvas')
    out.width = sw
    out.height = sh
    out.getContext('2d')!.drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh)
    setCropping(false)
    commit(out)
  }

  const applyResize = async () => {
    const c = await loadCanvas()
    if (!c || !resize || !resize.w || !resize.h) return
    const out = document.createElement('canvas')
    out.width = Math.round(resize.w)
    out.height = Math.round(resize.h)
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(c, 0, 0, out.width, out.height)
    setResize(null)
    commit(out)
  }

  /** Re-encodes the working data URL — this is where the preferred format and quality land. */
  const reencode = async (dataUrl: string, fmt: ImageFormat, quality: number) => {
    if (!dataUrl.startsWith(`data:${MIME[fmt]}`) || fmt === 'png' !== (quality === 100)) {
      const img = new Image()
      img.src = dataUrl
      try {
        await img.decode()
      } catch {
        return dataUrl
      }
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.getContext('2d')!.drawImage(img, 0, 0)
      return encode(c, fmt, quality)
    }
    return dataUrl
  }

  const save = async (mode: 'copy' | 'overwrite') => {
    if (!cur || !edit) return
    setBusy(true)
    const fmt = mode === 'overwrite' ? formatOf(cur.path) : imageFormat
    const url = await reencode(edit.url, fmt, imageQuality)
    const r = await api.saveImage(cur.path, url, mode)
    setBusy(false)
    if ('error' in r) {
      onSaved(`ذخیره نشد — ${r.error}`)
      return
    }
    setEdit(null)
    onSaved(mode === 'overwrite' ? `${cur.name} جایگزین شد` : `ذخیره شد: ${r.path.split('/').pop()}`)
    onChanged()
  }

  const ratio = (ev: React.MouseEvent) => {
    const el = imgRef.current
    if (!el) return null
    const b = el.getBoundingClientRect()
    if (!b.width || !b.height) return null
    return {
      x: Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width)),
      y: Math.min(1, Math.max(0, (ev.clientY - b.top) / b.height))
    }
  }

  const onStageDown = (ev: React.MouseEvent) => {
    if (!cropping) return
    const p = ratio(ev)
    if (!p) return
    setDrag(p)
    setCrop({ x: p.x, y: p.y, w: 0, h: 0 })
  }
  const onStageMove = (ev: React.MouseEvent) => {
    if (!cropping || !drag) return
    const p = ratio(ev)
    if (!p) return
    setCrop({
      x: Math.min(drag.x, p.x),
      y: Math.min(drag.y, p.y),
      w: Math.abs(p.x - drag.x),
      h: Math.abs(p.y - drag.y)
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (cropping) {
          setCropping(false)
          setCrop(null)
          return
        }
        if (resize) {
          setResize(null)
          return
        }
        onClose()
        return
      }
      if (cropping || resize) return
      const target = e.target as HTMLElement | null
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'c' || e.key === 'C') &&
        !(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'))
      ) {
        e.preventDefault()
        copyRef.current()
        return
      }
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          go(-1)
          break
        case 'ArrowRight':
          e.preventDefault()
          go(1)
          break
        case 'Home':
          e.preventDefault()
          setAt(0)
          break
        case 'End':
          e.preventDefault()
          setAt(Math.max(0, total - 1))
          break
        case '+':
        case '=':
          e.preventDefault()
          setFit(false)
          setZoom((z) => Math.min(8, z * 1.25))
          break
        case '-':
          e.preventDefault()
          setFit(false)
          setZoom((z) => Math.max(0.1, z / 1.25))
          break
        case '0':
          e.preventDefault()
          resetView()
          break
        case 'r':
        case 'R':
          e.preventDefault()
          setRot((r) => (r + 90) % 360)
          break
        case ' ':
          e.preventDefault()
          setSlide((s) => !s)
          break
        case 'f':
        case 'F':
          e.preventDefault()
          onFullscreen()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [total, cropping, resize, onClose, onFullscreen])

  /** Copy the picture itself (not its path) so it can be pasted into a chat or document. */
  const copyImage = async () => {
    if (!cur) return
    try {
      await copyImageContent(cur.path, edit?.url)
      onSaved(t('تصویر در کلیپ‌بورد کپی شد'))
    } catch (e) {
      onSaved(t('کپی تصویر نشد — {error}', { error: e instanceof Error ? e.message : String(e) }))
    }
  }
  copyRef.current = () => void copyImage()

  const src = edit?.url ?? (cur ? mediaUrl(cur.path) : '')

  return (
    <div className="gallery" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gallery-head">
        <span className="gallery-name" dir="auto">
          {cur?.name ?? ''}
        </span>
        <span className="pill">
          {t('{a} از {b}', { a: fa(Math.min(at + 1, total)), b: fa(total) })}
        </span>
        {edit && (
          <span className="pill edit">
            {t('ویرایش‌شده')} {fa(edit.w)}×{fa(edit.h)}
          </span>
        )}
        <span className="spacer" />
        <button className="tb" title={t('کپی تصویر در کلیپ‌بورد (Ctrl+C)')} onClick={() => void copyImage()}>
          <CopyIcon />
        </button>
        <button className="tb" title={t(t('چرخش به راست (R)'))} onClick={() => void rotate(1)}>
          <RotateIcon />
        </button>
        <button className="tb" title={t(t('چرخش به چپ'))} onClick={() => void rotate(-1)}>
          <RestoreIcon />
        </button>
        <button className="tb" title={t(t('آینهٔ افقی'))} onClick={() => void flip('y')}>
          <DupeIcon />
        </button>
        <button className="tb" title={t(t('آینهٔ عمودی'))} onClick={() => void flip('x')}>
          <ConfirmIcon />
        </button>
        <button
          className={'tb' + (cropping ? ' on' : '')}
          title={t(t('برش (روی تصویر بکش)'))}
          onClick={() => {
            setCropping((c) => !c)
            setCrop(null)
            resetView()
          }}
        >
          <SplitIcon />
        </button>
        <button
          className="tb"
          title={t(t('تغییر اندازه'))}
          onClick={() =>
            setResize({
              w: edit?.w ?? imgRef.current?.naturalWidth ?? 0,
              h: edit?.h ?? imgRef.current?.naturalHeight ?? 0
            })
          }
        >
          <MaximizeIcon />
        </button>
        <span className="divider" />
        <button
          className="tb"
          title={t(t('کوچک‌نمایی (-)'))}
          onClick={() => (setFit(false), setZoom((z) => Math.max(0.1, z / 1.25)))}
        >
          <MinusIcon />
        </button>
        <button
          className="tb"
          title={t(t('بزرگ‌نمایی (+)'))}
          onClick={() => (setFit(false), setZoom((z) => Math.min(8, z * 1.25)))}
        >
          <PlusIcon />
        </button>
        <button className="tb" title={t(t('اندازهٔ اصلی (0)'))} onClick={resetView}>
          <StarIcon />
        </button>
        <button
          className={'tb' + (slide ? ' on' : '')}
          title={t(t('پخش خودکار (Space)'))}
          onClick={() => setSlide((s) => !s)}
        >
          {slide ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="tb" title={t(t('تمام‌صفحه (F)'))} onClick={onFullscreen}>
          {fullscreen ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button className="tb" title={t(t('بستن (Esc)'))} onClick={onClose}>
          <XIcon size={13} />
        </button>
      </div>

      {cropping && (
        <div className="gallery-bar">
          {t('روی تصویر بکش تا محدودهٔ برش انتخاب شود')}
          <span className="spacer" />
          <button
            className="btn"
            disabled={!crop || crop.w < 0.01 || crop.h < 0.01}
            onClick={() => void applyCrop()}
          >
            {t('برش بده')}
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              setCropping(false)
              setCrop(null)
            }}
          >
            {t('انصراف')}
          </button>
        </div>
      )}

      {edit && !cropping && !resize && (
        <div className="gallery-bar">
          {t('ویرایش‌ها فقط در حافظه‌اند')}
          <span className="spacer" />
          <button className="btn" disabled={busy} onClick={() => void save('copy')}>
            {t('ذخیره به‌عنوان کپی')}
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => void save('overwrite')}>
            {t('جایگزینی فایل اصلی')}
          </button>
          <button className="btn ghost" onClick={() => setEdit(null)}>
            {t('دور انداختن')}
          </button>
        </div>
      )}

      <div
        className={'gallery-stage' + (cropping ? ' cropping' : '')}
        onMouseDown={onStageDown}
        onMouseMove={onStageMove}
        onMouseUp={() => setDrag(null)}
        onWheel={(e) => {
          if (cropping) return
          e.preventDefault()
          setFit(false)
          setZoom((z) => Math.min(8, Math.max(0.1, z * (e.deltaY < 0 ? 1.1 : 0.9))))
        }}
      >
        <button className="gallery-nav prev" title={t(t('قبلی (←)'))} onClick={() => go(-1)}>
          <ChevronRightIcon />
        </button>
        {cur && (
          <div className="gallery-frame">
            <img
              ref={imgRef}
              className="gallery-img"
              src={src}
              alt={cur.name}
              draggable={false}
              style={
                fit
                  ? { maxWidth: '100%', maxHeight: '100%' }
                  : {
                      maxWidth: 'none',
                      maxHeight: 'none',
                      transform: `scale(${zoom}) rotate(${rot}deg)`
                    }
              }
              onDoubleClick={() => !cropping && (setFit((f) => !f), setZoom(1))}
            />
            {cropping && crop && (
              <div
                className="crop-box"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.w * 100}%`,
                  height: `${crop.h * 100}%`
                }}
              />
            )}
          </div>
        )}
        <button className="gallery-nav next" title={t(t('بعدی (→)'))} onClick={() => go(1)}>
          <ChevronLeftIcon />
        </button>
      </div>

      {resize && (
        <div className="gallery-bar">
          <label className="inline-field">
            {t('عرض')}
            <input
              dir="ltr"
              type="number"
              value={resize.w}
              onChange={(e) => {
                const w = Number(e.target.value) || 0
                const srcW = edit?.w ?? imgRef.current?.naturalWidth ?? 1
                const srcH = edit?.h ?? imgRef.current?.naturalHeight ?? 1
                setResize({ w, h: Math.round(w * (srcH / srcW)) })
              }}
            />
          </label>
          <label className="inline-field">
            {t('ارتفاع')}
            <input
              dir="ltr"
              type="number"
              value={resize.h}
              onChange={(e) => {
                const h = Number(e.target.value) || 0
                const srcW = edit?.w ?? imgRef.current?.naturalWidth ?? 1
                const srcH = edit?.h ?? imgRef.current?.naturalHeight ?? 1
                setResize({ h, w: Math.round(h * (srcW / srcH)) })
              }}
            />
          </label>
          <span className="hint">{t(t('نسبت حفظ می‌شود'))}</span>
          <span className="spacer" />
          <button className="btn" onClick={() => void applyResize()}>
            {t('اعمال')}
          </button>
          <button className="btn ghost" onClick={() => setResize(null)}>
            {t('انصراف')}
          </button>
        </div>
      )}

      {total > 1 && (
        <div className="gallery-strip">
          {strip.map((img, i) => (
            <button
              key={img.path}
              ref={stripFrom + i === at ? activeThumb : undefined}
              className={'thumb-btn' + (stripFrom + i === at ? ' on' : '')}
              title={img.name}
              onClick={() => {
                setAt(stripFrom + i)
                setEdit(null)
                setCrop(null)
                setCropping(false)
                resetView()
              }}
            >
              <img src={mediaUrl(img.path)} alt="" loading="lazy" />
            </button>
          ))}
          {total > strip.length && (
            <span className="hint">
              {stripFrom > 0 ? t('{n} تصویر قبل… ·', { n: fa(stripFrom) }) : ''}
              {total - stripFrom - strip.length > 0
                ? t('و {n} تصویر دیگر…', { n: fa(total - stripFrom - strip.length) })
                : ''}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
