import { t } from './i18n.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Breakdown, type BreakdownMode } from './api'
import { fa, fmtSize, kindLabel, kindOfExt, type Kind } from './format'
import { dashSegments, foldSlices, sharePercent } from './chart'
import { XIcon } from './Icons'

/** Kind → the theme variable that already colours that kind of file everywhere else. */
const KIND_VAR: Record<Kind, string> = {
  dir: '--c-dir',
  image: '--c-image',
  video: '--c-video',
  audio: '--c-audio',
  archive: '--c-archive',
  text: '--c-text',
  doc: '--c-doc',
  pdf: '--c-pdf',
  sheet: '--c-sheet',
  slides: '--c-slides',
  code: '--c-code',
  file: '--c-file'
}

const EXT_VARS = ['--accent', '--c-image', '--c-video', '--c-archive', '--c-code', '--c-sheet', '--c-pdf', '--c-audio']

type Part = { key: string; label: string; value: number; color: string }

type Props = {
  path: string
  onClose(): void
}

/** One stroke circle per slice: no arc maths, and a hairline gap never shows through. */
function Donut({ parts, center, format }: { parts: Part[]; center: string; format: 'bytes' | 'count' }) {
  const size = 156
  const thickness = 19
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const visible = parts.filter((p) => p.value > 0)
  const segs = dashSegments(visible.map((p) => p.value), c)
  return (
    <div className="bd-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={center}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-3)" strokeWidth={thickness} />
        {segs.map((s, i) => (
          <circle
            key={visible[i].key}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`var(${visible[i].color})`}
            strokeWidth={thickness}
            strokeDasharray={`${s.len} ${c - s.len}`}
            strokeDashoffset={-s.offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          >
            <title>{`${visible[i].label}: ${format === 'bytes' ? fmtSize(visible[i].value, false) : fa(visible[i].value)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="bd-center">
        <strong dir="ltr">{center}</strong>
      </div>
    </div>
  )
}

function Legend({ parts, total, format }: { parts: Part[]; total: number; format: 'bytes' | 'count' }) {
  return (
    <ul className="bd-legend">
      {parts.map((p) => (
        <li key={p.key}>
          <span className="bd-dot" style={{ background: `var(${p.color})` }} />
          <span className="bd-label" dir="auto">
            {p.label}
          </span>
          <span className="bd-val" dir="ltr">
            {format === 'bytes' ? fmtSize(p.value, false) : fa(p.value)}
          </span>
          <span className="bd-pct" dir="ltr">
            {fa(sharePercent(p.value, total))}%
          </span>
        </li>
      ))}
    </ul>
  )
}

function Bar({ ratio, color }: { ratio: number; color: string }) {
  return (
    <span className="bd-bar">
      <span style={{ width: `${Math.max(1, Math.round(ratio * 100))}%`, background: `var(${color})` }} />
    </span>
  )
}

/** What is inside this folder: by size, by type, by extension, and what is biggest. */
export function BreakdownDialog({ path, onClose }: Props) {
  const [mode, setMode] = useState<BreakdownMode>('all')
  const [data, setData] = useState<Breakdown | null>(null)
  const [busy, setBusy] = useState(true)
  const [failed, setFailed] = useState('')
  const request = useRef(0)

  useEffect(() => {
    const id = ++request.current
    setBusy(true)
    setFailed('')
    void api
      .breakdown(path, mode)
      .then((r) => {
        if (request.current !== id) return
        setData(r)
      })
      .catch((e: unknown) => {
        if (request.current !== id) return
        setFailed(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (request.current === id) setBusy(false)
      })
  }, [path, mode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const byKindBytes = useMemo<Part[]>(() => {
    if (!data) return []
    const sums = new Map<Kind, number>()
    for (const e of data.byExt) {
      const k = kindOfExt(e.key)
      sums.set(k, (sums.get(k) ?? 0) + e.bytes)
    }
    return [...sums]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ key: k, label: kindLabel(k), value: v, color: KIND_VAR[k] }))
  }, [data])

  const byKindCount = useMemo<Part[]>(() => {
    if (!data) return []
    const counts = new Map<Kind, number>()
    if (data.folders > 0) counts.set('dir', data.folders)
    for (const e of data.byExt) {
      const k = kindOfExt(e.key)
      counts.set(k, (counts.get(k) ?? 0) + e.count)
    }
    return [...counts]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ key: k, label: kindLabel(k), value: v, color: KIND_VAR[k] }))
  }, [data])

  const byExt = useMemo<Part[]>(() => {
    if (!data) return []
    const rows = [...data.byExt]
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count || b.bytes - a.bytes)
      .map((e) => ({ key: e.key || '∅', label: e.key ? e.key.toUpperCase() : t('بدون پسوند'), value: e.count }))
    const { rows: head, rest } = foldSlices(rows, 7)
    const parts: Part[] = head.map((r, i) => ({ ...r, color: EXT_VARS[i % EXT_VARS.length] }))
    if (rest > 0) parts.push({ key: 'other', label: t('دیگر'), value: rest, color: '--panel-3' })
    return parts
  }, [data])

  const extTotal = byExt.reduce((sum, p) => sum + p.value, 0)
  const totals = data ? { bytes: fmtSize(data.bytes, false) } : null

  return (
    <div className="modal" onMouseDown={onClose}>
      <div
        className="dialog bd-dialog"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bd-head">
          <div className="bd-title">
            <span>{t('محتوای پوشه')}</span>
            <span className="bd-path" dir="ltr" title={path}>
              {path}
            </span>
          </div>
          <div className="seg bd-scope">
            <button className={mode === 'level1' ? 'on' : ''} onClick={() => setMode('level1')}>
              {t('فقط این پوشه')}
            </button>
            <button className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>
              {t('همهٔ سطوح')}
            </button>
          </div>
          <button className="tb" title={t('بستن')} onClick={onClose}>
            <XIcon />
          </button>
        </div>

        {busy && !data && <div className="bd-note">{t('در حال بررسی…')}</div>}
        {failed && <div className="bd-note error" dir="auto">{`${t('محاسبهٔ محتوا ممکن نشد')}: ${failed}`}</div>}
        {data && (
          <div className="bd-body">
            <div className="bd-facts">
              <span>
                <b dir="ltr">{totals?.bytes}</b> <span className="dim">{t('حجم')}</span>
              </span>
              <span dir="auto">
                {data.files === 1 ? t('یک فایل') : t('{n} فایل', { n: fa(data.files) })}
              </span>
              <span dir="auto">
                {data.folders === 1 ? t('یک پوشه') : t('{n} پوشه', { n: fa(data.folders) })}
              </span>
              {busy && <span className="dim">{t('در حال بررسی…')}</span>}
              {!busy && data.capped && (
                <span className="bd-cap">{t('اسکن به سقف خود رسید؛ نمودارها تقریبی‌اند')}</span>
              )}
            </div>

            <div className="bd-grid">
              <section className="bd-card">
                <h4>{t('حجم بر اساس نوع')}</h4>
                {byKindBytes.length ? (
                  <div className="bd-chart">
                    <Donut parts={byKindBytes} center={totals?.bytes ?? ''} format="bytes" />
                    <Legend parts={byKindBytes} total={data.bytes} format="bytes" />
                  </div>
                ) : (
                  <div className="bd-note">{t('فایلی در این پوشه نیست')}</div>
                )}
              </section>

              <section className="bd-card">
                <h4>{t('تعداد بر اساس نوع')}</h4>
                {byKindCount.length ? (
                  <div className="bd-chart">
                    <Donut parts={byKindCount} center={fa(byKindCount.reduce((sum, p) => sum + p.value, 0))} format="count" />
                    <Legend
                      parts={byKindCount}
                      total={byKindCount.reduce((sum, p) => sum + p.value, 0)}
                      format="count"
                    />
                  </div>
                ) : (
                  <div className="bd-note">{t('فایلی در این پوشه نیست')}</div>
                )}
              </section>

              <section className="bd-card">
                <h4>{t('بر اساس پسوند')}</h4>
                {byExt.length ? (
                  <div className="bd-chart">
                    <Donut parts={byExt} center={fa(extTotal)} format="count" />
                    <Legend parts={byExt} total={extTotal} format="count" />
                  </div>
                ) : (
                  <div className="bd-note">{t('فایلی در این پوشه نیست')}</div>
                )}
              </section>

              <section className="bd-card">
                <h4>{t('بزرگ‌ترین فایل‌ها')}</h4>
                {data.largest.length ? (
                  <ul className="bd-rows">
                    {data.largest.slice(0, 10).map((f) => (
                      <li key={f.path}>
                        <button
                          className="bd-row"
                          title={`${f.path}\n${t('نمایش در فایل‌منیجر')}`}
                          onClick={() => void api.reveal(f.path)}
                        >
                          <span className="bd-row-name" dir="auto">
                            {f.name}
                          </span>
                          <Bar ratio={f.size / (data.largest[0]?.size || 1)} color="--accent" />
                          <span className="bd-row-val" dir="ltr">
                            {fmtSize(f.size, false)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="bd-note">{t('فایلی در این پوشه نیست')}</div>
                )}
              </section>

              {mode === 'all' && data.children.length > 0 && (
                <section className="bd-card wide">
                  <h4>{t('بزرگ‌ترین پوشه‌ها')}</h4>
                  <ul className="bd-rows">
                    {data.children.slice(0, 10).map((c) => (
                      <li key={c.path}>
                        <span className="bd-row" title={c.path}>
                          <span className="bd-row-name" dir="auto">
                            {c.name}
                          </span>
                          <Bar ratio={c.bytes / (data.children[0]?.bytes || 1)} color="--c-dir" />
                          <span className="bd-row-val" dir="ltr">
                            {fmtSize(c.bytes, false)} ·{' '}
                            {c.files === 1 ? t('یک فایل') : t('{n} فایل', { n: fa(c.files) })}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            {t('بستن')}
          </button>
        </div>
      </div>
    </div>
  )
}
