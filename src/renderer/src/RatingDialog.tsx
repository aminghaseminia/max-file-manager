import { useState } from 'react'
import { baseName } from './format'
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
        <div className="dialog-title" dir="auto">
          امتیاز و توضیح — {name}
        </div>
        <div className="stars">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className={'star' + (value >= n ? ' on' : '')}
              title={`${n} ستاره`}
              onClick={() => setValue(value === n ? 0 : n)}
            >
              ★
            </button>
          ))}
          <span className="dim">{value ? `${value} از ۵` : 'بی‌امتیاز'}</span>
        </div>
        <textarea
          className="note-input"
          dir="auto"
          rows={4}
          placeholder="توضیح کوتاه…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
        />
        <div className="dialog-actions">
          <button className="btn" onClick={() => onSave(value, text)}>
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
            <span>قالب خروجی</span>
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
            <span>بلندترین ضلع</span>
            <span className="hint">پیکسل؛ ۰ یعنی اندازهٔ اصلی</span>
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
            <span>کیفیت</span>
            <span className="hint">فقط برای JPEG</span>
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
            <span>خروجی در پنجرهٔ مقابل</span>
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
