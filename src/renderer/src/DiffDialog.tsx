import { t } from './i18n.ts'
import { fa } from './format'
import { XIcon } from './Icons'

export type DiffLine = { kind: 'same' | 'add' | 'del' | 'change'; a?: number; b?: number; text: string }
export type DiffResult = { lines: DiffLine[]; added: number; removed: number; binary: boolean; coarse: boolean }

type Props = {
  a: string
  b: string
  result: DiffResult
  onClose(): void
}

/** Unified diff of two text files, with the same «فقط تفاوت‌ها» shortcut as the sync dialog. */
export function DiffDialog({ a, b, result, onClose }: Props) {
  const rows = result.lines
  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="dialog diff-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">{t(t('مقایسهٔ دو فایل'))}</div>
        <div className="sync-paths">
          <span dir="auto">{a}</span>
          <span className="dim">↔</span>
          <span dir="auto">{b}</span>
        </div>
        <div className="sync-summary">
          <span className="chip add">{t('{n} افزوده', { n: fa(result.added) })}</span>
          <span className="chip del">{t('{n} حذف‌شده', { n: fa(result.removed) })}</span>
          {result.binary && <span className="chip warn">{t(t('باینری'))}</span>}
          {result.coarse && <span className="chip warn">{t(t('مقایسهٔ خطی تقریبی (فایل بزرگ)'))}</span>}
        </div>
        <div className="diff-body" dir="ltr">
          {rows.slice(0, 6000).map((l, i) => (
            <div className={'diff-line ' + l.kind} key={i}>
              <span className="diff-n">{l.a ?? ''}</span>
              <span className="diff-n">{l.b ?? ''}</span>
              <span className="diff-mark">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : l.kind === 'change' ? '~' : ' '}</span>
              <span className="diff-text">{l.text}</span>
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="btn ghost" onClick={onClose}>
            <XIcon size={11} /> {t('بستن')}
          </button>
        </div>
      </div>
    </div>
  )
}
