import { t } from './i18n.ts'
import { useState } from 'react'
import { baseName, fa } from './format'
import { XIcon } from './Icons'

export type SyncRow = {
  rel: string
  state: string
  left?: { size: number; mtime: number; dir: boolean }
  right?: { size: number; mtime: number; dir: boolean }
}

const LABEL: Record<string, string> = {
  same: 'یکسان',
  leftOnly: 'فقط مبدأ',
  rightOnly: 'فقط مقصد',
  leftNewer: 'مبدأ جدیدتر',
  rightNewer: 'مقصد جدیدتر',
  sizeDiff: 'اندازه متفاوت',
  contentDiff: 'محتوا متفاوت',
  typeDiff: 'نوع متفاوت'
}

/** translated at render time, so switching the language does not need a restart */
const labelOfState = (state: string): string => t(labelOfState(state) ?? state)

const TONE: Record<string, string> = {
  same: '',
  leftOnly: 'add',
  rightOnly: 'del',
  leftNewer: 'add',
  rightNewer: 'del',
  sizeDiff: 'warn',
  contentDiff: 'warn',
  typeDiff: 'warn'
}

type Props = {
  left: string
  right: string
  rows: SyncRow[]
  capped: boolean
  busy: boolean
  result: string
  compareBy: 'mtime' | 'ctime' | 'hash'
  ignore: string
  onRecompare(compareBy: 'mtime' | 'ctime' | 'hash', ignore: string): void
  onApply(mode: 'ltr' | 'rtl', deleteExtra: boolean): void
  onClose(): void
}

/** Two-folder sync: show every difference, pick a direction, run it. */
export function SyncDialog({
  left,
  right,
  rows,
  capped,
  busy,
  result,
  compareBy,
  ignore,
  onRecompare,
  onApply,
  onClose
}: Props) {
  const [mode, setMode] = useState<'ltr' | 'rtl'>('ltr')
  const [deleteExtra, setDeleteExtra] = useState(false)
  const [only, setOnly] = useState(false)
  const [ignoreText, setIgnoreText] = useState(ignore)

  const differs = rows.filter((r) => r.state !== 'same')
  const shown = only ? differs : rows
  const count = (state: string) => rows.filter((r) => r.state === state).length

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="dialog sync-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">{t(t('همگام‌سازی دو پوشه'))}</div>

        <div className="sync-paths">
          <span dir="auto">{left}</span>
          <span className="dim">↔</span>
          <span dir="auto">{right}</span>
        </div>

        <div className="sync-controls">
          <div className="seg">
            {(['mtime', 'ctime', 'hash'] as const).map((k) => (
              <button
                key={k}
                className={compareBy === k ? 'on' : ''}
                title={
                  k === 'mtime'
                    ? t('تاریخ آخرین تغییر')
                    : k === 'ctime'
                      ? t('تاریخ ساخت فایل')
                      : t('هش محتوا (کندتر و دقیق‌تر)')
                }
                onClick={() => onRecompare(k, ignoreText)}
              >
                {k === 'mtime' ? t('تاریخ تغییر') : k === 'ctime' ? t('تاریخ ساخت') : t('هش محتوا')}
              </button>
            ))}
          </div>
          <label className="check-label">
            <span>{t(t('نادیده گرفتن:'))}</span>
            <input
              className="ignore-input"
              dir="ltr"
              placeholder="*.log, node_modules"
              value={ignoreText}
              onChange={(e) => setIgnoreText(e.target.value)}
              onBlur={() => ignoreText !== ignore && onRecompare(compareBy, ignoreText)}
              onKeyDown={(e) => e.key === 'Enter' && onRecompare(compareBy, ignoreText)}
            />
          </label>
          <div className="seg">
            <button className={mode === 'ltr' ? 'on' : ''} onClick={() => setMode('ltr')}>
              {baseName(left)} ← {baseName(right)}
            </button>
            <button className={mode === 'rtl' ? 'on' : ''} onClick={() => setMode('rtl')}>
              {baseName(right)} ← {baseName(left)}
            </button>
          </div>
          <label className="check-label">
            <input type="checkbox" checked={deleteExtra} onChange={(e) => setDeleteExtra(e.target.checked)} />
            <span>{t(t('فایل‌های اضافی مقصد به سطل بازیافت'))}</span>
          </label>
          <label className="check-label">
            <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />
            <span>{t(t('فقط تفاوت‌ها'))}</span>
          </label>
        </div>

        <div className="sync-summary">
          <span className="chip add">{t('{n} از مبدأ', { n: fa(count('leftOnly') + count('leftNewer')) })}</span>
          <span className="chip del">{t('{n} از مقصد', { n: fa(count('rightOnly') + count('rightNewer')) })}</span>
          <span className="chip warn">{t('{n} مشکوک', { n: fa(count('sizeDiff') + count('contentDiff') + count('typeDiff')) })}</span>
          <span className="chip">{t('{n} یکسان', { n: fa(count('same')) })}</span>
          {capped && <span className="chip warn">{t(t('فهرست بریده شد'))}</span>}
        </div>

        <div className="sync-list">
          {shown.slice(0, 500).map((r) => (
            <div className="sync-row" key={r.rel}>
              <span className={'chip ' + (TONE[r.state] ?? '')}>{labelOfState(r.state) ?? r.state}</span>
              <span className="sync-rel" dir="auto">
                {r.rel}
              </span>
              <span className="dim sync-size">
                {r.left && !r.left.dir ? `${fa(r.left.size)}B` : '—'} / {r.right && !r.right.dir ? `${fa(r.right.size)}B` : '—'}
              </span>
            </div>
          ))}
          {shown.length > 500 && <div className="dim">… {fa(shown.length - 500)} ردیف دیگر</div>}
        </div>

        {result && <div className="sync-result dim">{result}</div>}

        <div className="dialog-actions">
          <button className="btn" disabled={busy} onClick={() => onApply(mode, deleteExtra)}>
            اجرا
          </button>
          <button className="btn ghost" onClick={onClose}>
            <XIcon size={11} /> بستن
          </button>
        </div>
      </div>
    </div>
  )
}
