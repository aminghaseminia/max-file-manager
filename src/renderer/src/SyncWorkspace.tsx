import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from './i18n.ts'
import {
  api,
  type RsyncOptions,
  type SyncJob,
  type SyncMode,
  type SyncPlan,
  type SyncProgress,
  type SyncRow,
  type SyncRunSummary
} from './api'
import { baseName, fa, fmtDate, fmtSize } from './format'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SwapIcon,
  TrashIcon,
  XIcon
} from './Icons'
import { isRemotePath } from '../../shared/remote-path.ts'
import { newSyncJobId } from '../../shared/sync.ts'

type Tab = 'rows' | 'conflicts' | 'history' | 'jobs'

type Props = {
  left: string
  right: string
  initialMode: SyncMode
  compareBy: 'mtime' | 'hash'
  ignore: string
  deleteExtra: boolean
  jobs: SyncJob[]
  onClose(): void
  onSaveJobs(jobs: SyncJob[]): void
  onOpenJob(job: SyncJob): void
  /** remember the chosen direction for this pair, so the pill and the next open agree */
  onModeChange?(mode: SyncMode): void
  onFinished?(): void
}

const STATE_LABEL: Record<string, string> = {
  same: 'یکسان',
  leftOnly: 'فقط چپ',
  rightOnly: 'فقط راست',
  leftNewer: 'چپ جدیدتر',
  rightNewer: 'راست جدیدتر',
  sizeDiff: 'اندازه متفاوت',
  contentDiff: 'محتوا متفاوت',
  typeDiff: 'نوع متفاوت',
  conflict: 'تعارض'
}

const CONFLICT_LABEL: Record<string, string> = {
  bothChanged: 'هر دو طرف از آخرین همگام‌سازی تغییر کرده‌اند',
  editDelete: 'یک طرف تغییر کرده، طرف دیگر حذف شده',
  bothNew: 'در هر دو طرف با محتوای متفاوت ساخته شده',
  typeDiff: 'در یک طرف فایل، در طرف دیگر پوشه'
}

const MODE_LABEL: Record<string, string> = { ltr: 'چپ → راست', rtl: 'راست → چپ', both: 'دوطرفه' }

const ROW_H = 28

const labelOfState = (state: string): string => t(STATE_LABEL[state] ?? state)
const labelOfConflict = (kind: string | undefined): string => t(CONFLICT_LABEL[kind ?? ''] ?? kind ?? '')
const labelOfMode = (mode: string): string => t(MODE_LABEL[mode] ?? mode)

function toneOf(state: string): string {
  if (state === 'conflict') return 'warn'
  if (state === 'leftOnly' || state === 'leftNewer') return 'add'
  if (state === 'rightOnly' || state === 'rightNewer') return 'del'
  if (state === 'same') return ''
  return 'warn'
}

const ignoreList = (text: string): string[] =>
  text
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 50)

function conflictCount(plan: SyncPlan | null): number {
  return plan ? plan.conflicts.length : 0
}

/** A virtualised comparison table; only the visible rows exist in the DOM. */
function Rows({
  rows,
  selected,
  onToggle,
  onlyDiff
}: {
  rows: SyncRow[]
  selected: Set<string>
  onToggle(rel: string): void
  onlyDiff: boolean
}) {
  const shown = useMemo(() => (onlyDiff ? rows.filter((r) => r.state !== 'same') : rows), [rows, onlyDiff])
  const box = useRef<HTMLDivElement | null>(null)
  const [scroll, setScroll] = useState(0)
  const [height, setHeight] = useState(420)
  const measure = (el: HTMLDivElement | null): void => {
    box.current = el
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    setHeight(el.clientHeight)
  }
  const start = Math.max(0, Math.floor(scroll / ROW_H) - 6)
  const end = Math.min(shown.length, start + Math.ceil(height / ROW_H) + 10)
  return (
    <div className="sync-rows" ref={measure} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
      <div style={{ height: shown.length * ROW_H, position: 'relative' }}>
        {shown.slice(start, end).map((r, i) => {
          const at = start + i
          const size = (s?: { size: number; dir: boolean }): string =>
            s ? (s.dir ? t('پوشه') : fmtSize(s.size, false)) : '—'
          return (
            <div
              className="sync-row"
              key={r.rel}
              style={{ position: 'absolute', top: at * ROW_H, insetInline: 0, height: ROW_H }}
            >
              <span className="sync-check">
                <input
                  type="checkbox"
                  checked={selected.has(r.rel)}
                  disabled={r.state === 'same'}
                  onChange={() => onToggle(r.rel)}
                  aria-label={t('انتخاب')}
                />
              </span>
              <span className="sync-side dim">{size(r.left)}</span>
              <span className={'chip ' + toneOf(r.state)}>{labelOfState(r.state)}</span>
              <span className="sync-rel" dir="auto" title={r.rel}>
                {r.rel}
              </span>
              <span className="sync-side dim">{size(r.right)}</span>
            </div>
          )
        })}
      </div>
      {!shown.length && <div className="sync-empty dim">{t('ردیفی نیست')}</div>}
    </div>
  )
}

export function SyncWorkspace({
  left,
  right,
  initialMode,
  compareBy: initialCompareBy,
  ignore: initialIgnore,
  deleteExtra: initialDeleteExtra,
  jobs,
  onClose,
  onSaveJobs,
  onOpenJob,
  onModeChange,
  onFinished
}: Props) {
  const [mode, setMode] = useState<SyncMode>(initialMode)
  const pickMode = (next: SyncMode): void => {
    setMode(next)
    onModeChange?.(next)
  }
  const [compareBy, setCompareBy] = useState<'mtime' | 'hash'>(initialCompareBy)
  const [ignoreText, setIgnoreText] = useState(initialIgnore)
  const [deleteExtra, setDeleteExtra] = useState(initialDeleteExtra)
  const [rows, setRows] = useState<SyncRow[]>([])
  const [plan, setPlan] = useState<SyncPlan | null>(null)
  const [capped, setCapped] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [resolutions, setResolutions] = useState<Record<string, 'left' | 'right' | 'skip'>>({})
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [tab, setTab] = useState<Tab>('rows')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState<{ deletes: number; remote: number } | null>(null)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [history, setHistory] = useState<SyncRunSummary[]>([])
  const [restoreId, setRestoreId] = useState<string | null>(null)
  const [jobName, setJobName] = useState(`${baseName(left)} → ${baseName(right)}`)
  const [every, setEvery] = useState('')
  const [cron, setCron] = useState('')
  const [onStart, setOnStart] = useState(false)
  const [onMount, setOnMount] = useState(false)
  const [onChange, setOnChange] = useState(false)

  const ignored = useMemo(() => ignoreList(ignoreText), [ignoreText])
  const count = (state: string): number => rows.filter((r) => r.state === state).length
  const conflicts = plan?.conflicts ?? []
  const unresolved = conflicts.filter((c) => !resolutions[c.rel] || resolutions[c.rel] === 'skip')
  const currentJob = jobs.find((j) => j.left === left && j.right === right)
  const [useRsync, setUseRsync] = useState(currentJob?.useRsync === true)
  const [rsyncOpts, setRsyncOpts] = useState<RsyncOptions>(currentJob?.rsync ?? {})
  const rsyncAllowed = useRsync && mode !== 'both' && !isRemotePath(left) && !isRemotePath(right)

  useEffect(() => {
    if (!currentJob) return
    setJobName(currentJob.name)
    setEvery(currentJob.schedule.everyMinutes ? String(currentJob.schedule.everyMinutes) : '')
    setCron(currentJob.schedule.cron ?? '')
    setOnStart(currentJob.schedule.onStart === true)
    setOnMount(currentJob.schedule.onMount === true)
    setOnChange(currentJob.schedule.onChange === true)
    setUseRsync(currentJob.useRsync === true)
    setRsyncOpts(currentJob.rsync ?? {})
    // only a different job repopulates the form; typing must not be overwritten
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentJob?.id])

  const loadHistory = async (): Promise<void> => {
    try {
      setHistory(await api.sync.history(60))
    } catch {
      setHistory([])
    }
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      if (confirm) {
        setConfirm(null)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirm, onClose])

  useEffect(() => {
    void loadHistory()
    return api.sync.onProgress((p) => setProgress(p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    return api.sync.onDone(() => {
      setProgress(null)
      void loadHistory()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doCompare = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setMessage('')
    setConfirm(null)
    try {
      const r = await api.sync.plan({
        left,
        right,
        mode,
        compareBy,
        ignore: ignored,
        deleteExtra,
        useRsync: rsyncAllowed,
        rsync: rsyncOpts
      })
      setRows(r.rows)
      setPlan(r.plan)
      setCapped(r.cmp.capped)
      setSelected(new Set(r.rows.filter((x) => x.state !== 'same').map((x) => x.rel)))
      setResolutions({})
      setTab(r.plan.conflicts.length ? 'conflicts' : 'rows')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // the mode changes the plan (and the three-way comparison), so a fresh comparison is required
  useEffect(() => {
    void doCompare()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, right, mode, compareBy, useRsync])

  const execute = async (dryRun: boolean, confirmed = false): Promise<void> => {
    if (!plan) return
    if (!dryRun && unresolved.length) {
      setTab('conflicts')
      setError(t('{n} تعارض را اول حل کن', { n: fa(unresolved.length) }))
      return
    }
    const remoteDeletes = plan.remove.filter((a) => isRemotePath(a.from === 'left' ? left : right)).length
    if (!dryRun && !confirmed && plan.remove.length > 0) {
      setConfirm({ deletes: plan.remove.length, remote: remoteDeletes })
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const r = await api.sync.run({
        left,
        right,
        mode,
        compareBy,
        ignore: ignored,
        deleteExtra,
        selected: [...selected],
        resolutions,
        dryRun,
        useRsync: rsyncAllowed,
        rsync: rsyncOpts,
        confirmRemoteDelete: confirmed && remoteDeletes > 0
      })
      setRows(r.rows)
      setPlan(r.plan)
      if (r.blocked) {
        setTab('conflicts')
        setError(t('تعارض‌های تازه‌ای پیدا شد؛ اول تصمیم بگیر'))
      } else if (dryRun) {
        setMessage(
          t('تمرین خشک: {c} کپی · {d} حذف · {s} رد‌شده', {
            c: fa(r.plan.copy.length),
            d: fa(r.plan.remove.length),
            s: fa(r.plan.skipped)
          })
        )
      } else {
        setMessage(
          t('{c} کپی · {d} حذف · {s} رد‌شده', {
            c: fa(r.applied?.copied ?? 0),
            d: fa(r.applied?.removed ?? 0),
            s: fa(r.applied?.skipped ?? 0)
          })
        )
        if (r.summary.errors.length) setError(r.summary.errors[0])
        await loadHistory()
        onFinished?.()
        // show the state after the run, not the plan that was just applied
        await doCompare()
        setMessage(
          t('{c} کپی · {d} حذف · {s} رد‌شده', {
            c: fa(r.applied?.copied ?? 0),
            d: fa(r.applied?.removed ?? 0),
            s: fa(r.applied?.skipped ?? 0)
          })
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const toggle = (rel: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(rel)) next.delete(rel)
      else next.add(rel)
      return next
    })
  }

  const saveJob = (): void => {
    const id = currentJob?.id ?? newSyncJobId(jobs.map((j) => j.id))
    const job: SyncJob = {
      id,
      name: jobName.trim() || `${baseName(left)} → ${baseName(right)}`,
      left,
      right,
      direction: mode,
      compareBy,
      ignore: ignored,
      deleteExtra,
      useRsync: rsyncAllowed,
      ...(rsyncAllowed ? { rsync: rsyncOpts } : {}),
      enabled: true,
      schedule: {
        ...(every.trim() ? { everyMinutes: Number(every) || undefined } : {}),
        ...(cron.trim() ? { cron: cron.trim() } : {}),
        onStart,
        onMount,
        onChange
      }
    }
    onSaveJobs([...jobs.filter((j) => j.id !== id), job])
    setMessage(t('کار ذخیره شد'))
  }

  const restore = async (id: string): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await api.sync.restore(id, true)
      setMessage(
        t('بازگردانی: {c} کپی · {e} مورد قابل بازگشت نبود', {
          c: fa(r.applied?.copied ?? 0),
          e: fa(r.summary.errors.length)
        })
      )
      if (r.summary.errors.length) setError(r.summary.errors[0])
      await loadHistory()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setRestoreId(null)
    }
  }

  const pct = progress && progress.files ? Math.min(100, Math.round((progress.filesDone / progress.files) * 100)) : 0

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="dialog sync-workspace" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={t('همگام‌سازی دو پوشه')}>
        <div className="sync-head">
          <span className="sync-title">{t('همگام‌سازی دو پوشه')}</span>
          <span className="spacer" />
          <button className="tb" title={t('بستن')} onClick={onClose}>
            <XIcon size={13} />
          </button>
        </div>

        <div className="sync-paths">
          <span dir="auto" title={left}>
            {left}
          </span>
          <span className="dim">↔</span>
          <span dir="auto" title={right}>
            {right}
          </span>
        </div>

        <div className="sync-controls">
          <div className="seg" title={t('معیار مقایسه')}>
            <button className={compareBy === 'mtime' ? 'on' : ''} onClick={() => setCompareBy('mtime')}>
              {t('تاریخ تغییر')}
            </button>
            <button className={compareBy === 'hash' ? 'on' : ''} onClick={() => setCompareBy('hash')}>
              {t('هش محتوا')}
            </button>
          </div>
          <label className="check-label">
            <span>{t('نادیده گرفتن:')}</span>
            <input
              className="ignore-input"
              dir="ltr"
              placeholder="*.log, node_modules"
              value={ignoreText}
              onChange={(e) => setIgnoreText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && void doCompare()}
            />
          </label>
          <div className="seg" title={t('جهت همگام‌سازی')}>
            <button
              className={mode === 'ltr' ? 'on' : ''}
              title={`${baseName(left)} → ${baseName(right)}`}
              aria-label={t('از چپ به راست')}
              onClick={() => pickMode('ltr')}
            >
              <ArrowRightIcon size={11} />
            </button>
            <button
              className={mode === 'rtl' ? 'on' : ''}
              title={`${baseName(right)} → ${baseName(left)}`}
              aria-label={t('از راست به چپ')}
              onClick={() => pickMode('rtl')}
            >
              <ArrowLeftIcon size={11} />
            </button>
            <button
              className={mode === 'both' ? 'on' : ''}
              title={t('همگام‌سازی دوطرفه')}
              aria-label={t('دوطرفه')}
              onClick={() => pickMode('both')}
            >
              <SwapIcon size={11} />
            </button>
          </div>
          <label className="check-label">
            <input type="checkbox" checked={deleteExtra} onChange={(e) => setDeleteExtra(e.target.checked)} />
            <span>{t('حذف فایل‌های اضافی')}</span>
          </label>
          <label
            className="check-label"
            title={
              mode === 'both'
                ? t('rsync فقط یک‌طرفه است')
                : isRemotePath(left) || isRemotePath(right)
                  ? t('rsync فقط برای دو پوشهٔ لوکال است')
                  : t('موتور rsync (حذف‌ها به .mfm-trash مقصد می‌روند)')
            }
          >
            <input
              type="checkbox"
              checked={useRsync}
              disabled={mode === 'both' || isRemotePath(left) || isRemotePath(right)}
              onChange={(e) => setUseRsync(e.target.checked)}
            />
            <span>{t('rsync')}</span>
          </label>
          {useRsync && rsyncAllowed && (
            <details className="sync-rsync-opts">
              <summary>{t('تنظیمات rsync')}</summary>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={rsyncOpts.checksum === true}
                  onChange={(e) => setRsyncOpts((o) => ({ ...o, checksum: e.target.checked || undefined }))}
                />
                <span>{t('مقایسه با checksum')}</span>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={rsyncOpts.compress === true}
                  onChange={(e) => setRsyncOpts((o) => ({ ...o, compress: e.target.checked || undefined }))}
                />
                <span>{t('فشرده‌سازی')}</span>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={rsyncOpts.partial === true}
                  onChange={(e) => setRsyncOpts((o) => ({ ...o, partial: e.target.checked || undefined }))}
                />
                <span>{t('ادامهٔ فایل ناقص')}</span>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={rsyncOpts.inplace === true}
                  onChange={(e) => setRsyncOpts((o) => ({ ...o, inplace: e.target.checked || undefined }))}
                />
                <span>{t('inplace')}</span>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={rsyncOpts.sparse === true}
                  onChange={(e) => setRsyncOpts((o) => ({ ...o, sparse: e.target.checked || undefined }))}
                />
                <span>{t('فایل sparse')}</span>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={rsyncOpts.hardLinks === true}
                  onChange={(e) => setRsyncOpts((o) => ({ ...o, hardLinks: e.target.checked || undefined }))}
                />
                <span>{t('hard link')}</span>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={rsyncOpts.acls === true}
                  onChange={(e) => setRsyncOpts((o) => ({ ...o, acls: e.target.checked || undefined }))}
                />
                <span>ACL</span>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={rsyncOpts.xattrs === true}
                  onChange={(e) => setRsyncOpts((o) => ({ ...o, xattrs: e.target.checked || undefined }))}
                />
                <span>xattr</span>
              </label>
              <label className="check-label">
                <span>{t('سقف KB/s')}</span>
                <input
                  className="ignore-input"
                  dir="ltr"
                  placeholder="0"
                  value={rsyncOpts.bwlimitKB ?? ''}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setRsyncOpts((o) => ({
                      ...o,
                      bwlimitKB: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
                    }))
                  }}
                />
              </label>
            </details>
          )}
          <label className="check-label">
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
            <span>{t('فقط تفاوت‌ها')}</span>
          </label>
        </div>

        <div className="sync-summary">
          <span className="chip add">{t('{n} از چپ', { n: fa(count('leftOnly') + count('leftNewer')) })}</span>
          <span className="chip del">{t('{n} از راست', { n: fa(count('rightOnly') + count('rightNewer')) })}</span>
          <span className="chip warn">{t('{n} مشکوک', { n: fa(count('sizeDiff') + count('contentDiff') + count('typeDiff')) })}</span>
          <span className="chip warn">{t('{n} تعارض', { n: fa(count('conflict')) })}</span>
          <span className="chip">{t('{n} یکسان', { n: fa(count('same')) })}</span>
          {capped && <span className="chip warn">{t('فهرست بریده شد')}</span>}
          {selected.size > 0 && plan && (
            <span className="chip">{t('{n} انتخاب‌شده', { n: fa(selected.size) })}</span>
          )}
          {mode === 'both' && plan && (
            <span className="dim">
              {t('دوطرفه با {n} تصمیم', { n: fa(conflicts.length - unresolved.length) })}
            </span>
          )}
          <span className="spacer" />
          <button className="btn ghost" disabled={busy} onClick={() => void doCompare()}>
            {t('مقایسه')}
          </button>
          <button className="btn ghost" disabled={busy || !plan} onClick={() => void execute(true)}>
            {t('تمرین خشک')}
          </button>
          <button className="btn" disabled={busy || !plan} onClick={() => void execute(false)}>
            {t('اجرا')}
          </button>
        </div>

        <div className="sync-tabs">
          {(['rows', 'conflicts', 'history', 'jobs'] as Tab[]).map((id) => (
            <button key={id} className={'sync-tab' + (tab === id ? ' on' : '')} onClick={() => setTab(id)}>
              {id === 'rows'
                ? t('ردیف‌ها')
                : id === 'conflicts'
                  ? t('تعارض‌ها ({n})', { n: fa(unresolved.length) })
                  : id === 'history'
                    ? t('تاریخچه')
                    : t('کارها')}
            </button>
          ))}
          <span className="spacer" />
          {tab === 'rows' && rows.length > 0 && (
            <>
              <button
                className="tb"
                title={t('انتخاب همه')}
                onClick={() => setSelected(new Set(rows.filter((r) => r.state !== 'same').map((r) => r.rel)))}
              >
                <CheckIcon size={12} />
              </button>
              <button className="tb" title={t('هیچ‌کدام')} onClick={() => setSelected(new Set())}>
                <XIcon size={12} />
              </button>
            </>
          )}
        </div>

        <div className="sync-body">
          {tab === 'rows' && (
            <>
              <div className="sync-list-head">
                <span className="sync-check" />
                <span className="sync-side">{t('چپ')}</span>
                <span className="sync-head-state">{t('وضعیت')}</span>
                <span className="sync-rel">{t('مسیر')}</span>
                <span className="sync-side">{t('راست')}</span>
              </div>
              <Rows rows={rows} selected={selected} onToggle={toggle} onlyDiff={onlyDiff} />
            </>
          )}

          {tab === 'conflicts' && (
            <div className="sync-conflicts">
              {!conflicts.length && <div className="dim">{t('تعارضی نیست')}</div>}
              {conflicts.map((c) => (
                <div className="sync-conflict" key={c.rel}>
                  <div className="sync-conflict-head">
                    <span className="chip warn">{labelOfConflict(c.conflict)}</span>
                    <span className="sync-rel" dir="auto">
                      {c.rel}
                    </span>
                  </div>
                  <div className="sync-conflict-sides">
                    <div>
                      <b>{t('چپ')}</b>{' '}
                      <span className="dim">{c.left ? fmtDate(c.left.mtime) + ' · ' + fmtSize(c.left.size, c.left.dir) : '—'}</span>
                    </div>
                    <div>
                      <b>{t('راست')}</b>{' '}
                      <span className="dim">{c.right ? fmtDate(c.right.mtime) + ' · ' + fmtSize(c.right.size, c.right.dir) : '—'}</span>
                    </div>
                  </div>
                  {c.conflict === 'typeDiff' ? (
                    <div className="dim">
                      {t('یک طرف فایل است و طرف دیگر پوشه؛ این را باید دستی در فایل‌منیجر حل کنی و بعد دوباره مقایسه کنی')}
                    </div>
                  ) : (
                    <div className="seg">
                      <button
                        className={resolutions[c.rel] === 'left' ? 'on' : ''}
                        onClick={() => setResolutions((r) => ({ ...r, [c.rel]: 'left' }))}
                      >
                        {t('چپ درست است')}
                      </button>
                      <button
                        className={resolutions[c.rel] === 'right' ? 'on' : ''}
                        onClick={() => setResolutions((r) => ({ ...r, [c.rel]: 'right' }))}
                      >
                        {t('راست درست است')}
                      </button>
                      <button
                        className={resolutions[c.rel] === 'skip' ? 'on' : ''}
                        onClick={() => setResolutions((r) => ({ ...r, [c.rel]: 'skip' }))}
                      >
                        {t('رد کن')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'history' && (
            <div className="sync-history">
              {!history.length && <div className="dim">{t('تاریخچه‌ای نیست')}</div>}
              {history.map((r) => (
                <div className="sync-history-row" key={r.id} title={`${r.left} ↔ ${r.right}`}>
                  <span className="dim" dir="ltr">
                    {fmtDate(r.startedAt)}
                  </span>
                  <span className="chip">{labelOfMode(r.mode)}</span>
                  <span className="dim">
                    {t('{c} کپی · {d} حذف · {k} تعارض', {
                      c: fa(r.copied),
                      d: fa(r.removed),
                      k: fa(r.conflicts)
                    })}
                  </span>
                  <span className={'chip ' + (r.state === 'done' ? 'add' : 'warn')}>{t(r.state === 'done' ? 'انجام شد' : r.state === 'cancelled' ? 'لغو' : 'خطا')}</span>
                  <span className="spacer" />
                  {r.copied > 0 && restoreId !== r.id && (
                    <button className="tb" title={t('بازگردانی از تاریخچه')} onClick={() => setRestoreId(r.id)}>
                      <SwapIcon size={12} />
                    </button>
                  )}
                  {restoreId === r.id && (
                    <>
                      <span className="dim">{t('مطمئنی؟')}</span>
                      <button className="tb" title={t('تأیید بازگردانی')} onClick={() => void restore(r.id)}>
                        <CheckIcon size={12} />
                      </button>
                      <button className="tb" onClick={() => setRestoreId(null)}>
                        <XIcon size={12} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'jobs' && (
            <div className="sync-jobs">
              <div className="sync-job-form">
                <label className="check-label">
                  <span>{t('نام')}</span>
                  <input value={jobName} onChange={(e) => setJobName(e.target.value)} />
                </label>
                <label className="check-label">
                  <span>{t('هر چند دقیقه')}</span>
                  <input
                    className="ignore-input"
                    dir="ltr"
                    placeholder="0"
                    value={every}
                    onChange={(e) => setEvery(e.target.value)}
                  />
                </label>
                <label className="check-label">
                  <span>cron</span>
                  <input
                    className="ignore-input"
                    dir="ltr"
                    placeholder="0 3 * * *"
                    value={cron}
                    onChange={(e) => setCron(e.target.value)}
                  />
                </label>
                <label className="check-label">
                  <input type="checkbox" checked={onStart} onChange={(e) => setOnStart(e.target.checked)} />
                  <span>{t('در شروع برنامه')}</span>
                </label>
                <label className="check-label">
                  <input type="checkbox" checked={onMount} onChange={(e) => setOnMount(e.target.checked)} />
                  <span>{t('روی اتصال درایو')}</span>
                </label>
                <label className="check-label">
                  <input type="checkbox" checked={onChange} onChange={(e) => setOnChange(e.target.checked)} />
                  <span>{t('روی تغییر فایل (لوکال)')}</span>
                </label>
                <button className="btn" onClick={saveJob}>
                  <PlusIcon size={11} /> {currentJob ? t('ذخیرهٔ تغییرات') : t('ذخیره به‌عنوان کار')}
                </button>
              </div>
              <div className="sync-job-list">
                {!jobs.length && <div className="dim">{t('کاری ساخته نشده')}</div>}
                {jobs.map((j) => (
                  <div className="sync-job" key={j.id}>
                    <span className="sync-job-name" dir="auto">
                      {j.name}
                    </span>
                    <span className="chip">{labelOfMode(j.direction)}</span>
                    <span className="dim" dir="auto">
                      {j.left} ↔ {j.right}
                    </span>
                    <span className="spacer" />
                    <button className="tb" title={t('باز کردن')} onClick={() => onOpenJob(j)}>
                      <PlayIcon size={12} />
                    </button>
                    <button
                      className="tb"
                      title={t('حذف کار')}
                      onClick={() => onSaveJobs(jobs.filter((x) => x.id !== j.id))}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {plan && tab !== 'history' && tab !== 'jobs' && (
          <div className="sync-plan">
            <span className="dim">
              {t('طرح: {c} کپی · {d} حذف · {s} رد‌شده', {
                c: fa(plan.copy.length),
                d: fa(plan.remove.length),
                s: fa(plan.skipped)
              })}
            </span>
            {unresolved.length > 0 && (
              <span className="chip warn">{t('{n} تعارض حل‌نشده', { n: fa(unresolved.length) })}</span>
            )}
          </div>
        )}

        {confirm && (
          <div className="sync-confirm">
            <span>
              {t('{n} فایل حذف می‌شود', { n: fa(confirm.deletes) })}
              {confirm.remote > 0 &&
                ` — ${t('{n} حذف روی ریموت دائمی است و سطل بازیافت ندارد', { n: fa(confirm.remote) })}`}
              {rsyncAllowed
                ? ` — ${t('به .mfm-trash مقصد منتقل می‌شوند')}`
                : t(' و نسخه‌ای نگه داشته نمی‌شود. مطمئنی؟')}
            </span>
            <span className="spacer" />
            <button className="btn" onClick={() => void execute(false, true)}>
              {t('تأیید و اجرا')}
            </button>
            <button className="btn ghost" onClick={() => setConfirm(null)}>
              {t('لغو')}
            </button>
          </div>
        )}

        {progress && progress.state === 'running' && (
          <div className="sync-progress">
            <span className="bar">
              <i style={{ width: pct + '%' }} />
            </span>
            <span className="dim">
              {fa(pct)}٪ · {fmtSize(progress.bytesDone, false)} · <span dir="auto">{progress.current}</span>
            </span>
            <span className="spacer" />
            <button
              className="tb"
              title={progress.paused ? t('ادامه') : t('مکث')}
              onClick={() => (progress.paused ? void api.sync.resume() : void api.sync.pause())}
            >
              {progress.paused ? <PlayIcon size={11} /> : <PauseIcon size={11} />}
            </button>
            <button className="tb" title={t('لغو')} onClick={() => void api.sync.cancel()}>
              <XIcon size={11} />
            </button>
          </div>
        )}

        {(error || message) && (
          <div className={'sync-message ' + (error ? 'err' : 'ok')}>{error || message}</div>
        )}

        <div className="dialog-actions">
          <button className="btn ghost" onClick={onClose}>
            {t('بستن')}
          </button>
        </div>
      </div>
    </div>
  )
}
