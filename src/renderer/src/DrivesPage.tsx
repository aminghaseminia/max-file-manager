import { useCallback, useEffect, useState } from 'react'
import { api, type DiskVolume, type MemoryInfo } from './api'
import { DriveIcon, EjectIcon, MemoryIcon, RefreshIcon, SwapIcon, UsbIcon } from './Icons'
import { fa, fmtSize } from './format'
import { t } from './i18n'

type Props = {
  sizeFormat: 'human' | 'bytes'
  onOpen(path: string): void
}

const pctOf = (used: number | null, total: number): number =>
  total > 0 && used !== null ? Math.min(100, Math.max(0, Math.round((used / total) * 100))) : 0

const levelClass = (pct: number): string => (pct >= 90 ? ' danger' : pct >= 75 ? ' warn' : '')

function UsageBar({
  used,
  total,
  free,
  sizeFormat
}: {
  used: number | null
  total: number
  free: number | null
  sizeFormat: 'human' | 'bytes'
}) {
  const pct = pctOf(used, total)
  const known = total > 0 && used !== null
  return (
    <div className={'drive-usage' + levelClass(pct)}>
      <div
        className="drive-usage-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? pct : undefined}
        aria-label={t('فضای مصرف‌شده')}
      >
        <span style={{ width: `${known ? pct : 0}%` }} />
      </div>
      <div className="drive-usage-caption">
        <strong>{known ? `${fa(pct)}٪` : '—'}</strong>
        <span>{t('مصرف‌شده')}</span>
        {known && <span className="drive-usage-split">{fmtSize(used ?? 0, false, sizeFormat)} {t('از')} {fmtSize(total, false, sizeFormat)}</span>}
      </div>
      {known && free !== null && (
        <div className="drive-usage-free">
          <span>{t('آزاد')}</span>
          <b>{fmtSize(free, false, sizeFormat)}</b>
        </div>
      )}
    </div>
  )
}

export function DrivesPage({ sizeFormat, onOpen }: Props) {
  const [volumes, setVolumes] = useState<DiskVolume[]>([])
  const [memory, setMemory] = useState<MemoryInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true)
    setError('')
    try {
      const [nextVolumes, nextMemory] = await Promise.all([
        api.drives.volumes(),
        api.system.memory()
      ])
      setVolumes(nextVolumes)
      setMemory(nextMemory)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (showLoader) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let live = true
    const run = (initial = false) => {
      void load(initial).catch(() => undefined)
    }
    run(true)
    const iv = setInterval(() => {
      if (live) run(false)
    }, 10_000)
    const onFocus = () => {
      if (live) run(false)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      live = false
      clearInterval(iv)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const mounted = volumes.filter((v) => v.mounted && v.mountpoint)
  const unmounted = volumes.filter((v) => !v.mounted)
  const totals = mounted.reduce(
    (acc, v) => {
      if (v.total <= 0) return acc
      acc.total += v.total
      acc.used += v.used ?? 0
      acc.free += v.free ?? 0
      return acc
    },
    { total: 0, used: 0, free: 0 }
  )
  const totalPct = pctOf(totals.used, totals.total)

  const openVolume = (v: DiskVolume) => {
    if (v.mounted && v.mountpoint) onOpen(v.mountpoint)
  }

  const mountVolume = async (v: DiskVolume) => {
    if (busy) return
    setBusy(v.device)
    setError('')
    const result = await api.drives.mount(v.device)
    setBusy('')
    if (result.ok) await load(false)
    else setError(result.error || t('اتصال انجام نشد'))
  }

  const unmountVolume = async (v: DiskVolume) => {
    if (busy) return
    setBusy(v.device)
    setError('')
    const result = await api.drives.unmount(v.device)
    setBusy('')
    if (result.ok) await load(false)
    else setError(result.error || t('جداسازی انجام نشد'))
  }

  return (
    <main className="drives-page">
      <header className="drives-page-head">
        <div>
          <div className="drives-eyebrow">{t('این کامپیوتر')}</div>
          <h1>{t('درایوها و دیسک‌ها')}</h1>
          <p>{t('میزان فضای مصرف‌شده و آزاد درایوها و وضعیت حافظه')}</p>
        </div>
        <button
          className={'btn' + (loading ? ' disabled' : '')}
          disabled={loading}
          onClick={() => void load(true)}
          title={t('نوسازی')}
        >
          <RefreshIcon />
          {t('نوسازی')}
        </button>
      </header>

      {error && <div className="drives-error" dir="auto">{error}</div>}
      {loading && !volumes.length && !memory ? (
        <div className="drives-loading"><span className="vp-spin" />{t('در حال خواندن…')}</div>
      ) : (
        <>
          {totals.total > 0 && (
            <section className="drives-totals" aria-label={t('فضای ذخیره‌سازی')}>
              <div>
                <span>{t('کل فضای ذخیره‌سازی')}</span>
                <b>{fmtSize(totals.total, false, sizeFormat)}</b>
              </div>
              <div>
                <span>{t('مصرف‌شده')}</span>
                <b>{fmtSize(totals.used, false, sizeFormat)}</b>
              </div>
              <div>
                <span>{t('آزاد')}</span>
                <b>{fmtSize(totals.free, false, sizeFormat)}</b>
              </div>
              <div className={'drives-total-ring' + levelClass(totalPct)}>
                <span>{t('مصرف')}</span>
                <b>{fa(totalPct)}٪</b>
              </div>
            </section>
          )}

          {memory && (
            <section className="drives-section">
              <div className="drives-section-head">
                <h2>{t('حافظه')}</h2>
                <span className="drives-section-count">{t('وضعیت زنده')}</span>
              </div>
              <div className="memory-grid">
                <article className={'memory-card' + levelClass(pctOf(memory.used, memory.total))}>
                  <header>
                    <span className="drive-card-icon"><MemoryIcon size={22} /></span>
                    <div>
                      <strong>{t('رم')}</strong>
                      <small>{t('حافظهٔ فیزیکی')}</small>
                    </div>
                    <span className="drive-pill">{fmtSize(memory.total, false, sizeFormat)}</span>
                  </header>
                  <UsageBar used={memory.used} total={memory.total} free={memory.available} sizeFormat={sizeFormat} />
                </article>
                <article className={'memory-card' + levelClass(pctOf(memory.swapUsed, memory.swapTotal))}>
                  <header>
                    <span className="drive-card-icon"><SwapIcon size={22} /></span>
                    <div>
                      <strong>swap</strong>
                      <small>{t('حافظهٔ مبادله‌ای')}</small>
                    </div>
                    <span className="drive-pill">{memory.swapTotal > 0 ? fmtSize(memory.swapTotal, false, sizeFormat) : t('فعال نیست')}</span>
                  </header>
                  {memory.swapTotal > 0 ? (
                    <UsageBar used={memory.swapUsed} total={memory.swapTotal} free={memory.swapFree} sizeFormat={sizeFormat} />
                  ) : (
                    <div className="drive-unmounted-text">{t('swap روی این سیستم فعال نیست')}</div>
                  )}
                </article>
              </div>
            </section>
          )}

          <section className="drives-section">
            <div className="drives-section-head">
              <h2>{t('درایوها و دیسک‌ها')}</h2>
              <span className="drives-section-count">
                {fa(mounted.length)} {t('متصل')}{unmounted.length ? ` · ${fa(unmounted.length)} ${t('متصل نیست')}` : ''}
              </span>
            </div>
            {volumes.length === 0 ? (
              <div className="drives-empty">{t('درایوی پیدا نشد')}</div>
            ) : (
              <>
                <div className="drive-grid">
                  {mounted.map((v) => {
                    const used = v.used ?? (v.free !== null && v.total > 0 ? v.total - v.free : null)
                    const pct = pctOf(used, v.total)
                    return (
                      <article
                        key={v.id}
                        className={'drive-card' + levelClass(pct)}
                        role="button"
                        tabIndex={0}
                        title={v.mountpoint ?? v.device}
                        onClick={() => openVolume(v)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault()
                            openVolume(v)
                          }
                        }}
                      >
                        <header>
                          <span className="drive-card-icon">{v.removable ? <UsbIcon size={24} /> : <DriveIcon size={24} />}</span>
                          <div className="drive-card-name">
                            <strong dir="auto">{v.name === 'System' ? t('درایو سیستم') : v.name}</strong>
                            <small dir="ltr">{v.device}</small>
                          </div>
                          {v.system && <span className="drive-pill system">{t('سیستم')}</span>}
                          {v.removable && <span className="drive-pill">{t('قابل جداسازی')}</span>}
                        </header>
                        <UsageBar used={used} total={v.total} free={v.free} sizeFormat={sizeFormat} />
                        <footer>
                          <span className="drive-path" dir="ltr">{v.mountpoint}</span>
                          {v.fsType && <span className="drive-fs">{v.fsType}</span>}
                          {v.removable && v.device.startsWith('/dev/') && (
                            <button
                              className="drive-eject"
                              title={t('جداسازی ایمن')}
                              aria-label={t('جداسازی ایمن')}
                              disabled={busy === v.device}
                              onClick={(ev) => {
                                ev.stopPropagation()
                                void unmountVolume(v)
                              }}
                            >
                              <EjectIcon size={14} />
                            </button>
                          )}
                        </footer>
                      </article>
                    )
                  })}
                  {unmounted.map((v) => (
                    <article key={v.id} className="drive-card unmounted">
                      <header>
                        <span className="drive-card-icon"><UsbIcon size={24} /></span>
                        <div className="drive-card-name">
                          <strong dir="auto">{v.name}</strong>
                          <small dir="ltr">{v.device}</small>
                        </div>
                        <span className="drive-pill">{t('متصل نیست')}</span>
                      </header>
                      <div className="drive-unmounted-text">
                        {v.total > 0 ? fmtSize(v.total, false, sizeFormat) : t('حجم نامشخص')}
                      </div>
                      <footer>
                        <span className="drive-path" dir="ltr">{v.fsType || v.device}</span>
                        {v.device.startsWith('/dev/') && (
                          <button
                            className="btn small"
                            disabled={busy === v.device}
                            onClick={() => void mountVolume(v)}
                          >
                            <DriveIcon size={13} />
                            {busy === v.device ? t('در حال اتصال…') : t('اتصال')}
                          </button>
                        )}
                      </footer>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </main>
  )
}
