import { t } from './i18n.ts'
import { useEffect, useRef, useState } from 'react'
import { api, type Entry, type FileProperties } from './api'
import { fa, fmtDate, fmtSize } from './format'
import type { Tags } from './api'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  XIcon
} from './Icons'
import {
  NO_ADJ,
  aspectText,
  dominantColors,
  isNeutral,
  luminanceHistogram,
  megapixels,
  type Adj,
  type Swatch
} from './imageinfo'

type Props = {
  entry: Entry
  /** working pixels (after the transforms already committed) */
  width: number
  height: number
  /** changes whenever the working image changes, so the histogram is recomputed */
  analysisKey: string
  /** the working data URL, or '' to read the file itself */
  src: string
  adjust: Adj
  onAdjust(next: Adj): void
  onApplyAdjust(): void
  onResetAdjust(): void
  onRotate(deg: 90 | -90 | 180): void
  onFlip(axis: 'x' | 'y'): void
  onCrop(): void
  onResize(): void
  onScale(pct: number): void
  onClose(): void
}

const SLIDERS: { key: keyof Adj; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: 'روشنایی', min: 50, max: 150 },
  { key: 'contrast', label: 'کنتراست', min: 50, max: 150 },
  { key: 'saturation', label: 'اشباع رنگ', min: 0, max: 200 },
  { key: 'grayscale', label: 'سیاه‌وسفید', min: 0, max: 100 }
]

const SCALES = [25, 50, 75, 100]

function Section({
  title,
  open,
  onToggle,
  children
}: {
  title: string
  open: boolean
  onToggle(): void
  children: React.ReactNode
}) {
  return (
    <section className="ginfo-section">
      <button className="ginfo-head" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDownIcon size={11} /> : <ChevronLeftIcon size={11} />}
        <span>{title}</span>
      </button>
      {open && <div className="ginfo-body">{children}</div>}
    </section>
  )
}

/** Gallery-only information sheet: summary, EXIF, colour analysis and the edit tools. */
export function GalleryInfo({
  entry,
  width,
  height,
  analysisKey,
  src,
  adjust,
  onAdjust,
  onApplyAdjust,
  onResetAdjust,
  onRotate,
  onFlip,
  onCrop,
  onResize,
  onScale,
  onClose
}: Props) {
  const [props, setProps] = useState<FileProperties | null>(null)
  const [tags, setTags] = useState<Tags | null>(null)
  const [colors, setColors] = useState<Swatch[]>([])
  const [hist, setHist] = useState<number[]>([])
  const [open, setOpen] = useState<Record<string, boolean>>({
    summary: true,
    colors: true,
    exif: true,
    edit: true
  })
  const analysis = useRef(0)

  useEffect(() => {
    let live = true
    setProps(null)
    setTags(null)
    void api
      .properties(entry.path)
      .then((r) => live && !('error' in r) && setProps(r))
      .catch(() => undefined)
    void api
      .tags([entry.path])
      .then((r) => live && setTags((r?.[entry.path] as Tags) ?? null))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [entry.path])

  // colour analysis runs on a small copy: a 40 MP photo must not be decoded twice at full size
  useEffect(() => {
    const id = ++analysis.current
    void (async () => {
      // mfm:// taints a canvas, so the analysis always runs on a data: URL
      const source = src || (await api.imageData(entry.path).catch(() => null))?.dataUrl || ''
      if (!source || analysis.current !== id) return
      const img = new Image()
      img.src = source
      try {
        await img.decode()
      } catch {
        if (analysis.current === id) {
          setColors([])
          setHist([])
        }
        return
      }
      if (analysis.current !== id) return
      const side = 160
      const ratio = Math.min(1, side / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.naturalWidth * ratio))
      c.height = Math.max(1, Math.round(img.naturalHeight * ratio))
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(img, 0, 0, c.width, c.height)
      const data = ctx.getImageData(0, 0, c.width, c.height).data
      setColors(dominantColors(data, 5))
      setHist(luminanceHistogram(data, 40))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisKey])

  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }))
  const row = (label: string, value: React.ReactNode, ltr = false) => (
    <div className="ginfo-row">
      <span className="ginfo-key">{label}</span>
      <span className={'ginfo-val' + (ltr ? ' ltr' : '')} dir={ltr ? 'ltr' : 'auto'}>
        {value}
      </span>
    </div>
  )

  const exifRows: [string, string | undefined][] = tags
    ? [
        ['دوربین', tags.camera],
        ['تاریخ عکس', tags.date],
        ['ISO', tags.iso],
        ['دیافراگم', tags.fnumber],
        ['نوردهی', tags.exposure],
        ['فاصلهٔ کانونی', tags.focal]
      ]
    : []
  const hasExif = exifRows.some(([, v]) => !!v)

  const mp = megapixels(width, height)

  return (
    <aside className="gallery-side" aria-label={t('اطلاعات تصویر')}>
      <div className="ginfo-head-bar">
        <span className="ginfo-title">{t('اطلاعات تصویر')}</span>
        <button className="tb" title={t('بستن پنل')} onClick={onClose}>
          <XIcon size={13} />
        </button>
      </div>

      <div className="ginfo-scroll">
        <Section title={t('خلاصه')} open={!!open.summary} onToggle={() => toggle('summary')}>
          {row(t('نام'), entry.name)}
          {row(t('ابعاد'), `${fa(width)} × ${fa(height)}`, true)}
          {row(t('مگاپیکسل'), `${fa(mp >= 10 ? mp.toFixed(1) : mp.toFixed(2))} MP`, true)}
          {row(t('نسبت ابعاد'), aspectText(width, height), true)}
          {row(t('حجم'), fmtSize(props?.size ?? entry.size, false))}
          {row(t('فرمت'), props?.mime || entry.ext.toUpperCase(), true)}
          {row(t('تغییر یافته'), fmtDate(props?.mtime ?? entry.mtime, 'iso', true), true)}
          {props && row(t('ساخته‌شده'), fmtDate(props.birthtime, 'iso', true), true)}
          {row(t('مسیر'), props?.path ?? entry.path, true)}
        </Section>

        <Section title={t('تحلیل رنگ')} open={!!open.colors} onToggle={() => toggle('colors')}>
          {colors.length > 0 ? (
            <>
              <div className="ginfo-swatches">
                {colors.map((c) => (
                  <span
                    key={c.hex}
                    className="ginfo-swatch"
                    title={`${c.hex} · ${fa(Math.round(c.share * 100))}%`}
                    style={{ background: c.hex }}
                  />
                ))}
              </div>
              <div className="ginfo-swatch-legend" dir="ltr">
                {colors.slice(0, 3).map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join(' · ')}
              </div>
              {hist.length > 0 && (
                <svg
                  className="ginfo-hist"
                  viewBox={`0 0 ${hist.length * 4} 48`}
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={t('هیستوگرام روشنایی')}
                >
                  {hist.map((v, i) => (
                    <rect
                      key={i}
                      x={i * 4}
                      y={48 - Math.max(1, v * 48)}
                      width={3.4}
                      height={Math.max(1, v * 48)}
                      rx="1"
                    />
                  ))}
                </svg>
              )}
            </>
          ) : (
            <div className="dim">{t('تحلیل رنگ در دسترس نیست')}</div>
          )}
        </Section>

        {hasExif && (
          <Section title={t('داده‌های EXIF')} open={!!open.exif} onToggle={() => toggle('exif')}>
            {exifRows.filter(([, v]) => !!v).map(([label, value]) => row(t(label), value, true))}
          </Section>
        )}

        <Section title={t('ویرایش')} open={!!open.edit} onToggle={() => toggle('edit')}>
          <div className="ginfo-tools">
            <button className="btn ghost mini" onClick={() => onRotate(-90)}>
              {t('چرخش به چپ')}
            </button>
            <button className="btn ghost mini" onClick={() => onRotate(90)}>
              {t('چرخش به راست')}
            </button>
            <button className="btn ghost mini" onClick={() => onRotate(180)}>
              {t('چرخش ۱۸۰ درجه')}
            </button>
            <button className="btn ghost mini" onClick={() => onFlip('y')}>
              {t('آینهٔ افقی')}
            </button>
            <button className="btn ghost mini" onClick={() => onFlip('x')}>
              {t('آینهٔ عمودی')}
            </button>
            <button className="btn ghost mini" onClick={onCrop}>
              {t('برش')}
            </button>
            <button className="btn ghost mini" onClick={onResize}>
              {t('تغییر اندازه')}
            </button>
          </div>

          <div className="ginfo-sub">{t('مقیاس (٪ از اندازهٔ فعلی)')}</div>
          <div className="ginfo-scales">
            {SCALES.map((pct) => (
              <button key={pct} className="btn ghost mini" onClick={() => onScale(pct)}>
                {fa(pct)}%
              </button>
            ))}
          </div>

          <div className="ginfo-sub" style={{ marginTop: 8 }}>
            {t('تنظیمات')}
          </div>
          {SLIDERS.map((s) => (
            <label key={s.key} className="ginfo-slider">
              <span>{t(s.label)}</span>
              <input
                type="range"
                min={s.min}
                max={s.max}
                value={adjust[s.key]}
                onChange={(e) => onAdjust({ ...adjust, [s.key]: Number(e.target.value) })}
              />
              <b dir="ltr">{fa(adjust[s.key])}</b>
            </label>
          ))}
          <div className="ginfo-actions">
            <button className="btn mini" disabled={isNeutral(adjust)} onClick={onApplyAdjust}>
              {t('اعمال تنظیمات')}
            </button>
            <button className="btn ghost mini" onClick={onResetAdjust}>
              {t('بازنشانی')}
            </button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {t('این تنظیمات فقط پیش‌نمایش‌اند تا «اعمال» را بزنی')}
          </div>
        </Section>
      </div>
    </aside>
  )
}
