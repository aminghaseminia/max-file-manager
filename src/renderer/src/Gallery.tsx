import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Entry } from './api'
import { fa, mediaUrl } from './format'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ConfirmIcon,
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
}

type Edit = { url: string; w: number; h: number }
type Rect = { x: number; y: number; w: number; h: number }

/** Full-window photo viewer with everyday edits: rotate, flip, crop, resize, save. */
export function Gallery({
  images,
  startPath,
  fullscreen,
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

  const total = images.length
  const cur = images[Math.min(at, total - 1)]
  const strip = useMemo(() => images.slice(0, 60), [images])

  const resetView = () => {
    setZoom(1)
    setRot(0)
    setFit(true)
  }

  const go = (d: number) => {
    setAt((i) => (total ? (i + d + total) % total : 0))
    setEdit(null)
    setCrop(null)
    setCropping(false)
    resetView()
  }

  useEffect(() => {
    if (!slide || total < 2) return
    const t = setInterval(() => go(1), 3000)
    return () => clearInterval(t)
  }, [slide, total])

  /** Every edit runs on a canvas at full resolution, so no step loses pixels. */
  const loadCanvas = async (): Promise<HTMLCanvasElement | null> => {
    if (!cur) return null
    // mfm:// taints a canvas, so editing runs on the file bytes as a data: URL instead
    let src = edit?.url
    if (!src) {
      const r = await api.imageData(cur.path)
      if (!r.dataUrl) {
        onSaved(r.error ?? 'تصویر بارگذاری نشد')
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
    setEdit({ url: c.toDataURL('image/png'), w: c.width, h: c.height })
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

  const save = async (mode: 'copy' | 'overwrite') => {
    if (!cur || !edit) return
    setBusy(true)
    const r = await api.saveImage(cur.path, edit.url, mode)
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

  const src = edit?.url ?? (cur ? mediaUrl(cur.path) : '')

  return (
    <div className="gallery" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gallery-head">
        <span className="gallery-name" dir="auto">
          {cur?.name ?? ''}
        </span>
        <span className="pill">
          {fa(Math.min(at + 1, total))} از {fa(total)}
        </span>
        {edit && (
          <span className="pill edit">
            ویرایش‌شده {fa(edit.w)}×{fa(edit.h)}
          </span>
        )}
        <span className="spacer" />
        <button className="tb" title="چرخش به راست (R)" onClick={() => void rotate(1)}>
          <RotateIcon />
        </button>
        <button className="tb" title="چرخش به چپ" onClick={() => void rotate(-1)}>
          <RestoreIcon />
        </button>
        <button className="tb" title="آینهٔ افقی" onClick={() => void flip('y')}>
          <DupeIcon />
        </button>
        <button className="tb" title="آینهٔ عمودی" onClick={() => void flip('x')}>
          <ConfirmIcon />
        </button>
        <button
          className={'tb' + (cropping ? ' on' : '')}
          title="برش (روی تصویر بکش)"
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
          title="تغییر اندازه"
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
          title="کوچک‌نمایی (-)"
          onClick={() => (setFit(false), setZoom((z) => Math.max(0.1, z / 1.25)))}
        >
          <MinusIcon />
        </button>
        <button
          className="tb"
          title="بزرگ‌نمایی (+)"
          onClick={() => (setFit(false), setZoom((z) => Math.min(8, z * 1.25)))}
        >
          <PlusIcon />
        </button>
        <button className="tb" title="اندازهٔ اصلی (0)" onClick={resetView}>
          <StarIcon />
        </button>
        <button
          className={'tb' + (slide ? ' on' : '')}
          title="پخش خودکار (Space)"
          onClick={() => setSlide((s) => !s)}
        >
          {slide ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="tb" title="تمام‌صفحه (F)" onClick={onFullscreen}>
          {fullscreen ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button className="tb" title="بستن (Esc)" onClick={onClose}>
          <XIcon size={13} />
        </button>
      </div>

      {cropping && (
        <div className="gallery-bar">
          روی تصویر بکش تا محدودهٔ برش انتخاب شود
          <span className="spacer" />
          <button
            className="btn"
            disabled={!crop || crop.w < 0.01 || crop.h < 0.01}
            onClick={() => void applyCrop()}
          >
            برش بده
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              setCropping(false)
              setCrop(null)
            }}
          >
            انصراف
          </button>
        </div>
      )}

      {edit && !cropping && !resize && (
        <div className="gallery-bar">
          ویرایش‌ها فقط در حافظه‌اند
          <span className="spacer" />
          <button className="btn" disabled={busy} onClick={() => void save('copy')}>
            ذخیره به‌عنوان کپی
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => void save('overwrite')}>
            جایگزینی فایل اصلی
          </button>
          <button className="btn ghost" onClick={() => setEdit(null)}>
            دور انداختن
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
        <button className="gallery-nav prev" title="قبلی (←)" onClick={() => go(-1)}>
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
        <button className="gallery-nav next" title="بعدی (→)" onClick={() => go(1)}>
          <ChevronLeftIcon />
        </button>
      </div>

      {resize && (
        <div className="gallery-bar">
          <label className="inline-field">
            عرض
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
            ارتفاع
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
          <span className="hint">نسبت حفظ می‌شود</span>
          <span className="spacer" />
          <button className="btn" onClick={() => void applyResize()}>
            اعمال
          </button>
          <button className="btn ghost" onClick={() => setResize(null)}>
            انصراف
          </button>
        </div>
      )}

      {total > 1 && (
        <div className="gallery-strip">
          {strip.map((img, i) => (
            <button
              key={img.path}
              className={'thumb-btn' + (i === at ? ' on' : '')}
              title={img.name}
              onClick={() => {
                setAt(i)
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
            <span className="hint">و {fa(total - strip.length)} تصویر دیگر…</span>
          )}
        </div>
      )}
    </div>
  )
}
