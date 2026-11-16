import { t } from './i18n.ts'
import type { Job, SyncProgress } from './api'
import { fa, fmtSize } from './format'
import { CopyIcon, MoveIcon, PauseIcon, PlayIcon, SwapIcon, XIcon } from './Icons'

type Props = {
  jobs: Job[]
  onPause(id: string): void
  onResume(id: string): void
  onCancel(id: string): void
  onClear(): void
  /** the sync run currently in progress, if any */
  sync?: SyncProgress | null
  syncPaused?: boolean
  onSyncPause?(): void
  onSyncResume?(): void
  onSyncCancel?(): void
}

const STATE_LABEL: Record<string, string> = {
  queued: 'در صف',
  running: 'در حال اجرا',
  paused: 'مکث',
  done: 'انجام شد',
  cancelled: 'لغو شد',
  error: 'خطا'
}

export function JobsBar({
  jobs,
  onPause,
  onResume,
  onCancel,
  onClear,
  sync,
  syncPaused,
  onSyncPause,
  onSyncResume,
  onSyncCancel
}: Props) {
  if (!jobs.length && !sync) return null
  const syncPct = sync && sync.files ? Math.min(100, Math.round((sync.filesDone / sync.files) * 100)) : 0
  return (
    <div className="jobs">
      <div className="jobs-head">
        <span className="jobs-title">{t(t('عملیات‌ها'))}</span>
        <span className="pill">
          {t('{n} در حال اجرا', {
            n: fa(jobs.filter((j) => j.state === 'running').length + (sync?.state === 'running' ? 1 : 0))
          })}
        </span>
        <span className="spacer" />
        <button className="tb" title={t(t('پاک کردن تمام‌شده‌ها'))} onClick={onClear}>
          <XIcon size={12} />
        </button>
      </div>
      <div className="jobs-list">
        {sync && sync.state === 'running' && (
          <div className={'job running' + (syncPaused ? ' paused' : '')}>
            <span className="ic">
              <SwapIcon />
            </span>
            <span className="job-label" dir="auto" title={sync.current}>
              {t('همگام‌سازی')} · {sync.current || '…'}
            </span>
            <span className="bar">
              <i style={{ width: syncPct + '%' }} />
            </span>
            <span className="job-meta">
              {t('{n}٪', { n: fa(syncPct) })} · {fmtSize(sync.bytesDone, false)} ·{' '}
              {t('{n} از {m}', { n: fa(sync.filesDone), m: fa(sync.files) })}
            </span>
            <span className="spacer" />
            <button
              className="tb"
              title={syncPaused ? t('ادامه') : t('مکث')}
              onClick={() => (syncPaused ? onSyncResume?.() : onSyncPause?.())}
            >
              {syncPaused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button className="tb" title={t('لغو')} onClick={() => onSyncCancel?.()}>
              <XIcon size={12} />
            </button>
          </div>
        )}
        {jobs.map((j) => {
          const pct = j.bytes ? Math.min(100, Math.round((j.done / j.bytes) * 100)) : j.state === 'done' ? 100 : 0
          const live = j.state === 'running' || j.state === 'paused' || j.state === 'queued'
          return (
            <div key={j.id} className={'job ' + j.state}>
              <span className="ic">{j.kind === 'copy' ? <CopyIcon /> : <MoveIcon />}</span>
              <span className="job-label" dir="auto" title={j.current || j.label}>
                {j.label || '…'}
              </span>
              <span className="bar">
                <i style={{ width: pct + '%' }} />
              </span>
              <span className="job-meta">
                {j.state === 'running'
                  ? `${t('{n}٪', { n: fa(pct) })} · ${fmtSize(j.done, false)} · ${fmtSize(j.speed, false)}/${t('ث')}`
                  : t(STATE_LABEL[j.state])}
              </span>
              <span className="spacer" />
              {!!j.skipped && (
                <span className="job-skip" title={t(t('با فیلتر انتقال رد شد'))}>
                  {t('{n} رد‌شده', { n: fa(j.skipped) })}
                </span>
              )}
              {j.errors.length > 0 && (
                <span className="job-err" title={j.errors.join('\n')}>
                  {t('{n} خطا', { n: fa(j.errors.length) })}
                </span>
              )}
              {(j.state === 'running' || j.state === 'paused') && (
                <button
                  className="tb"
                  title={j.state === 'paused' ? t('ادامه') : t('مکث')}
                  onClick={() => (j.state === 'paused' ? onResume(j.id) : onPause(j.id))}
                >
                  {j.state === 'paused' ? <PlayIcon /> : <PauseIcon />}
                </button>
              )}
              {live && (
                <button className="tb" title={t(t('لغو'))} onClick={() => onCancel(j.id)}>
                  <XIcon size={12} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
