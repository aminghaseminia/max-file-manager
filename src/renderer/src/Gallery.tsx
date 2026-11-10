import { useEffect, useMemo, useState } from 'react'
import type { Entry } from './api'
import { fa, fmtSize, mediaUrl } from './format'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MaximizeIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateIcon,
  RestoreIcon,
  StarIcon,
  XIcon,
  MinusIcon
} from './Icons'

type Props = {
  /** images of the current folder, in the order the pane shows them */
  images: Entry[]
  startPath: string
  onClose(): void
  onFullscreen(): void
  fullscreen: boolean
}

/** Full-window photo viewer: arrows browse the folder, +/- zoom, R rotate, Space slideshow. */
export function Gallery({ images, startPath, onClose, onFullscreen, fullscreen }: Props) {
  const start = Math.max(0, images.findIndex((i) => i.path === startPath))
  const [at, setAt] = useState(start)
  const [zoom, setZoom] = useState(1)
  const [rot, setRot] = useState(0)
  const [fit, setFit] = useState(true)
  const [slide, setSlide] = useState(false)

  const total = images.length
  const cur = images[Math.min(at, total - 1)]
  const strip = useMemo(() => images.slice(0, 60), [images])

  const go = (d: number) => {
    setAt((i) => (total ? (i + d + total) % total : 0))
    setZoom(1)
    setRot(0)
    setFit(true)
  }

  useEffect(() => {
    if (!slide || total < 2) return
    const t = setInterval(() => go(1), 3000)
    return () => clearInterval(t)
  }, [slide, total])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          onClose()
          break
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
          setFit(true)
          setZoom(1)
          setRot(0)
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
  }, [total, onClose, onFullscreen])

  return (
    <div className="gallery" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gallery-head">
        <span className="gallery-name" dir="auto">
          {cur?.name ?? ''}
        </span>
        <span className="pill">
          {fa(Math.min(at + 1, total))} از {fa(total)}
        </span>
        {cur && <span className="gallery-size">{fmtSize(cur.size, false)}</span>}
        <span className="spacer" />
        <button className="tb" title="کوچک‌نمایی (-)" onClick={() => (setFit(false), setZoom((z) => Math.max(0.1, z / 1.25)))}>
          <MinusIcon />
        </button>
        <button className="tb" title="بزرگ‌نمایی (+)" onClick={() => (setFit(false), setZoom((z) => Math.min(8, z * 1.25)))}>
          <PlusIcon />
        </button>
        <button className="tb" title="اندازهٔ اصلی (0)" onClick={() => (setFit(true), setZoom(1), setRot(0))}>
          <StarIcon />
        </button>
        <button className="tb" title="چرخش (R)" onClick={() => setRot((r) => (r + 90) % 360)}>
          <RotateIcon />
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

      <div className="gallery-stage" onWheel={(e) => {
        e.preventDefault()
        setFit(false)
        setZoom((z) => Math.min(8, Math.max(0.1, z * (e.deltaY < 0 ? 1.1 : 0.9))))
      }}>
        <button className="gallery-nav prev" title="قبلی (←)" onClick={() => go(-1)}>
          <ChevronRightIcon />
        </button>
        {cur && (
          <img
            className="gallery-img"
            src={mediaUrl(cur.path)}
            alt={cur.name}
            style={
              fit
                ? { maxWidth: '100%', maxHeight: '100%' }
                : {
                    maxWidth: 'none',
                    maxHeight: 'none',
                    transform: `scale(${zoom}) rotate(${rot}deg)`
                  }
            }
            onDoubleClick={() => (setFit((f) => !f), setZoom(1))}
          />
        )}
        <button className="gallery-nav next" title="بعدی (→)" onClick={() => go(1)}>
          <ChevronLeftIcon />
        </button>
      </div>

      {total > 1 && (
        <div className="gallery-strip">
          {strip.map((img, i) => (
            <button
              key={img.path}
              className={'thumb-btn' + (i === at ? ' on' : '')}
              title={img.name}
              onClick={() => {
                setAt(i)
                setZoom(1)
                setRot(0)
              }}
            >
              <img src={mediaUrl(img.path)} alt="" loading="lazy" />
            </button>
          ))}
          {total > strip.length && <span className="hint">و {fa(total - strip.length)} تصویر دیگر…</span>}
        </div>
      )}
    </div>
  )
}
