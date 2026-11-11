import { t } from './i18n.ts'
import { useState } from 'react'
import { api } from './api'
import { fa } from './format'
import { XIcon } from './Icons'

type Props = {
  name: string
  stars: number
  note: string
  onSave(stars: number, note: string): void
  onClose(): void
}

/** Stars and a short description for one file, stored in the folder's own .mfm.json. */
export function RatingDialog({ name, stars, note, onSave, onClose }: Props) {
  const [value, setValue] = useState(stars)
  const [text, setText] = useState(note)

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="dialog rating-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">
          <span>{t('امتیاز و توضیح')}</span>
          <span className="dialog-sub" dir="auto" title={name}>
            {name}
          </span>
        </div>
        <div className="stars" dir="ltr">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className={'star' + (value >= n ? ' on' : '')}
              title={t('{n} ستاره', { n: fa(n) })}
              onClick={() => setValue(value === n ? 0 : n)}
            >
              ★
            </button>
          ))}
          <span className={'star-value' + (value ? '' : ' dim')}>
            {value ? t('{n} از ۵', { n: fa(value) }) : t('بی‌امتیاز')}
          </span>
        </div>
        <label className="dialog-field">
          <span>{t('توضیح')}</span>
          <textarea
            className="note-input"
            dir="auto"
            rows={4}
            placeholder={t(t('توضیح کوتاه…'))}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
          />
        </label>
        <div className="dialog-actions">
          <button className="btn ghost" onClick={onClose}>
            {t('انصراف')}
          </button>
          <button className="btn" onClick={() => onSave(value, text)}>
            {t('ذخیره')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** WebP is not encodable in the main process, so those go through a canvas here. */
export async function convertToWebp(files: string[], maxSide: number, quality: number): Promise<{ done: number; errors: string[] }> {
  let done = 0
  const errors: string[] = []
  for (const src of files) {
    try {
      const r = await api.imageData(src)
      if ('error' in r || !r.dataUrl) throw new Error(r.error ?? t('خواندن تصویر ممکن نشد'))
      const img = new Image()
      img.src = r.dataUrl
      await img.decode()
      const scale = maxSide > 0 ? Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight)) : 1
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.naturalWidth * scale))
      c.height = Math.max(1, Math.round(img.naturalHeight * scale))
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      const out = c.toDataURL('image/webp', Math.min(100, Math.max(1, quality)) / 100)
      if (!out.startsWith('data:image/webp')) throw new Error(t('این نسخهٔ کرومیوم WebP نمی‌سازد'))
      const saved = await api.saveImageAs(src, out)
      if ('error' in saved) throw new Error(saved.error)
      done++
    } catch (e: any) {
      errors.push(`${src.split('/').pop()}: ${e?.message ?? String(e)}`)
    }
  }
  return { done, errors }
}

type ConvertProps = {
  count: number
  onRun(opts: { format: 'jpeg' | 'png' | 'webp'; maxSide: number; quality: number; toOtherPane?: boolean }): void
  onClose(): void
  otherPane: string
  busy: boolean
  result: string
}

/** Batch image conversion: format, longest side and JPEG quality. */
export function ConvertDialog({ count, onRun, onClose, otherPane, busy, result }: ConvertProps) {
  const [format, setFormat] = useState<'jpeg' | 'png' | 'webp'>('jpeg')
  const [maxSide, setMaxSide] = useState(1920)
  const [quality, setQuality] = useState(88)
  const [toOther, setToOther] = useState(false)

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="dialog convert-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">تبدیل تصاویر ({count} فایل)</div>
        <div className="pref-row">
          <div className="pref-label">
            <span>{t(t('قالب خروجی'))}</span>
          </div>
          <div className="pref-control">
            <div className="seg">
              {(['jpeg', 'png', 'webp'] as const).map((f) => (
                <button key={f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)}>
                  {f === 'jpeg' ? 'JPEG' : f === 'png' ? 'PNG' : 'WebP'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="pref-row">
          <div className="pref-label">
            <span>{t(t('بلندترین ضلع'))}</span>
            <span className="hint">{t(t('پیکسل؛ ۰ یعنی اندازهٔ اصلی'))}</span>
          </div>
          <div className="pref-control">
            <input
              className="pref-input"
              type="number"
              min={0}
              step={64}
              value={maxSide}
              onChange={(e) => setMaxSide(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
        </div>
        <div className="pref-row">
          <div className="pref-label">
            <span>{t(t('کیفیت'))}</span>
            <span className="hint">{t(t('فقط برای JPEG'))}</span>
          </div>
          <div className="pref-control">
            <input
              className="pref-input"
              type="number"
              min={1}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Math.min(100, Math.max(1, Number(e.target.value) || 88)))}
            />
          </div>
        </div>
        <div className="pref-row">
          <div className="pref-label">
            <span>{t(t('خروجی در پنجرهٔ مقابل'))}</span>
            <span className="hint" dir="auto">
              {otherPane}
            </span>
          </div>
          <div className="pref-control">
            <label className="check">
              <input type="checkbox" checked={toOther} onChange={(e) => setToOther(e.target.checked)} />
            </label>
          </div>
        </div>
        {result && <div className="dim result-line">{result}</div>}
        <div className="dialog-actions">
          <button
            className="btn"
            disabled={busy}
            onClick={() => onRun({ format, maxSide, quality, toOtherPane: toOther })}
          >
            تبدیل
          </button>
          <button className="btn ghost" onClick={onClose}>
            <XIcon size={11} /> بستن
          </button>
        </div>
      </div>
    </div>
  )
}

type TagProps = {
  name: string
  tags: Record<string, string>
  onSave(fields: Record<string, string>): void
  onClose(): void
}

/** Writes ID3 text fields; EXIF is read-only for now. */
export function TagDialog({ name, tags, onSave, onClose }: TagProps) {
  const [title, setTitle] = useState(tags.title ?? '')
  const [artist, setArtist] = useState(tags.artist ?? '')
  const [album, setAlbum] = useState(tags.album ?? '')
  const [year, setYear] = useState(tags.year ?? '')

  const field = (label: string, value: string, set: (v: string) => void) => (
    <div className="pref-row">
      <div className="pref-label">
        <span>{label}</span>
      </div>
      <div className="pref-control">
        <input className="pref-input wide" dir="auto" value={value} onChange={(e) => set(e.target.value)} />
      </div>
    </div>
  )

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="dialog rating-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title" dir="auto">
          برچسب‌های صوتی — {name}
        </div>
        {field(t('عنوان'), title, setTitle)}
        {field(t('هنرمند'), artist, setArtist)}
        {field(t('آلبوم'), album, setAlbum)}
        {field(t('سال'), year, setYear)}
        <div className="hint">{t(t('فقط فایل‌های صوتی (ID3) نوشته می‌شوند؛ EXIF فعلاً فقط خوانده می‌شود.'))}</div>
        <div className="dialog-actions">
          <button className="btn" onClick={() => onSave({ title, artist, album, year })}>
            ذخیره
          </button>
          <button className="btn ghost" onClick={onClose}>
            <XIcon size={11} /> بستن
          </button>
        </div>
      </div>
    </div>
  )
}
