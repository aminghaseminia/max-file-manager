import { t } from './i18n.ts'
import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { baseName, dirOf, fa, joinPath, planRename, type RenameMode } from './format'

type Props = {
  paths: string[]
  onApply(pairs: { from: string; to: string }[]): void
  onClose(): void
}

export function RenameDialog({ paths, onApply, onClose }: Props) {
  const [tags, setTags] = useState<Record<string, Record<string, string>>>({})
  const [mode, setMode] = useState<RenameMode>('template')
  const [template, setTemplate] = useState('{name}')
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [start, setStart] = useState(1)
  const [pad, setPad] = useState(2)

  const names = useMemo(() => paths.map(baseName), [paths])
  const planned = useMemo(
    () => planRename(names, { mode, template, find, replace, start, pad, tags }),
    [names, mode, template, find, replace, start, pad]
  )
  const pairs = useMemo(
    () =>
      names
        .map((n, i) => ({ from: paths[i], to: joinPath(dirOf(paths[i]), planned[i]) }))
        .filter((p) => p.from !== p.to),
    [names, paths, planned]
  )
  const clash = new Set(planned).size !== planned.length
  const canApply = pairs.length > 0 && !clash

  useEffect(() => {
    if (mode !== 'template') return
    let live = true
    // the planner keys by file name, the api returns absolute paths
    void api.tags(paths).then((r) => {
      if (!live) return
      setTags(Object.fromEntries(Object.entries(r ?? {}).map(([p, t]) => [baseName(p), t])))
    })
    return () => {
      live = false
    }
  }, [mode, paths])

  const anyTags = Object.values(tags).some((t) => t && t.kind && t.kind !== 'none')

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="dialog wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dlg-title">
          {t('تغییر نام گروهی')} · {t('{n} مورد', { n: fa(paths.length) })}
        </div>

        <div className="seg">
          <button className={mode === 'template' ? 'on' : ''} onClick={() => setMode('template')}>
            الگو
          </button>
          <button className={mode === 'regex' ? 'on' : ''} onClick={() => setMode('regex')}>
            عبارت باقاعده
          </button>
        </div>

        {mode === 'template' ? (
          <>
            <label className="field">
              <span>{t(t('الگو'))}</span>
              <input dir="auto" value={template} onChange={(e) => setTemplate(e.target.value)} />
            </label>
            <div className="hint">
              {anyTags ? t('کلیدهای متادیتا هم کار می‌کنند: ') : ''}
              {anyTags && <span dir="ltr">{'{title} {artist} {album} {year} {date} {camera}'}</span>}
            </div>
            <div className="hint">
              جای‌نگهدارها: <code>{'{name}'}</code>{t(t('نام،'))}<code>{'{ext}'}</code> پسوند،{' '}
              <code>{'{n}'}</code>{t(t('شماره،'))}<code>{'{nn}'}</code> شماره با صفر
            </div>
            <div className="two">
              <label className="field">
                <span>{t(t('شروع شماره'))}</span>
                <input
                  dir="ltr"
                  type="number"
                  value={start}
                  onChange={(e) => setStart(Number(e.target.value) || 0)}
                />
              </label>
              <label className="field">
                <span>{t(t('صفر پیشرو'))}</span>
                <input
                  dir="ltr"
                  type="number"
                  value={pad}
                  onChange={(e) => setPad(Number(e.target.value) || 1)}
                />
              </label>
            </div>
          </>
        ) : (
          <div className="two">
            <label className="field">
              <span>{t(t('الگوی جست‌وجو'))}</span>
              <input dir="ltr" value={find} onChange={(e) => setFind(e.target.value)} placeholder="(\d+)" />
            </label>
            <label className="field">
              <span>{t(t('جایگزین'))}</span>
              <input dir="ltr" value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="$1" />
            </label>
          </div>
        )}

        <div className="rn-preview">
          {names.slice(0, 8).map((n, i) => (
            <div key={n + i} className={'rn-row' + (planned[i] === n ? '' : ' chg')}>
              <span dir="auto" className="old">{n}</span>
              <span className="arrow">←</span>
              <span dir="auto" className="new">{planned[i]}</span>
            </div>
          ))}
          {names.length > 8 && (
            <div className="hint">{t('و {n} مورد دیگر…', { n: fa(names.length - 8) })}</div>
          )}
        </div>

        {clash && <div className="warn">{t(t('دو فایل نام یکسان می‌گیرند — الگو را عوض کن.'))}</div>}

        <div className="dlg-actions">
          <button disabled={!canApply} onClick={() => onApply(pairs)}>
            اعمال {fa(pairs.length)} تغییر
          </button>
          <button onClick={onClose}>{t(t('انصراف'))}</button>
        </div>
      </div>
    </div>
  )
}
