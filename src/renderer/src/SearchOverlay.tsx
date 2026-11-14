import { t } from './i18n.ts'
import { useEffect, useRef, useState } from 'react'
import { api, type SearchHit, type SearchProgress } from './api'
import { fa, fmtDate, fmtSize } from './format'
import { FolderIcon, RefreshIcon, SearchIcon, XIcon } from './Icons'

type Props = {
  roots: string[]
  exclude: string[]
  onReveal(hit: SearchHit): void
  onOpen(hit: SearchHit): void
  onManage(): void
  onClose(): void
}

/** wait until typing settles; a query per keystroke hammers the index for nothing */
const DEBOUNCE = 500

/** Fast overlay over the indexed database: type, arrow through hits, Enter reveals. */
export function SearchOverlay({ roots, exclude, onReveal, onOpen, onManage, onClose }: Props) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [stats, setStats] = useState<{ files: number; dirs: number; lastIndex: number } | null>(null)
  const [status, setStatus] = useState<SearchProgress | null>(null)
  const [doneMsg, setDoneMsg] = useState('')
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.search.status().then((s) => {
      setStatus(s)
      setStats(s.stats)
    })
    input.current?.focus()
    const off = api.search.onProgress((p) => setStatus((cur) => ({ ...cur, ...p })))
    return off
  }, [])

  useEffect(() => {
    if (!q.trim()) {
      setHits([])
      return
    }
    let live = true
    const timer = setTimeout(() => {
      void api.search.query(q, 300).then((r) => {
        if (!live) return
        setHits(r)
        setAt(0)
      })
    }, DEBOUNCE)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q])

  const reindex = async () => {
    setDoneMsg('')
    setStatus((cur) => (cur ? { ...cur, running: true, scanned: 0, done: 0 } : cur))
    const r = await api.search.index({ roots, exclude })
    setStats(r.stats)
    setDoneMsg(
      t('ایندکس شد: {files} فایل در {seconds} ثانیه', {
        files: fa(r.files),
        seconds: fa(Math.round(r.durationMs / 100) / 10)
      })
    )
  }

  // not memoized: a live language switch must translate this line too
  const age = (() => {
    if (!stats?.lastIndex) return t('هنوز ایندکس نشده')
    const mins = Math.round((Date.now() - stats.lastIndex) / 60000)
    return mins < 1 ? t('همین حالا') : `${fa(mins)} ${t('دقیقه پیش')}`
  })()

  const onKey = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Escape') return onClose()
    if (ev.key === 'ArrowDown') {
      ev.preventDefault()
      setAt((i) => Math.min(hits.length - 1, i + 1))
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault()
      setAt((i) => Math.max(0, i - 1))
    } else if (ev.key === 'Enter' && hits[at]) {
      ev.preventDefault()
      if (ev.ctrlKey) onOpen(hits[at])
      else onReveal(hits[at])
    }
  }

  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('.sr.on')
    el?.scrollIntoView({ block: 'nearest' })
  }, [at])

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="search-overlay" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="search-head">
          <SearchIcon />
          <input
            ref={input}
            autoFocus
            className="search-input"
            placeholder={t(t('نام فایل یا پوشه… (پیشوند و چند کلمه هم کار می‌کند)'))}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="dim search-stats">
            {stats
              ? t('{files} فایل · {dirs} پوشه · {age}', {
                  files: fa(stats.files),
                  dirs: fa(stats.dirs),
                  age
                })
              : '…'}
          </span>
          <button className="tb" title={t(t('به‌روزرسانی ایندکس'))} onClick={() => void reindex()}>
            <RefreshIcon />
          </button>
          <button className="tb" title={t(t('پوشه‌ها و استثناها'))} onClick={onManage}>
            ⚙
          </button>
          <button className="tb" title={t(t('بستن (Esc)'))} onClick={onClose}>
            <XIcon size={12} />
          </button>
        </div>

        {status?.running ? (
          <div className="search-busy dim">
            {t('ایندکس: {scanned} بررسی‌شده · {done}/{total} پوشه', {
              scanned: fa(status.scanned),
              done: fa(status.done),
              total: fa(status.total)
            })}
          </div>
        ) : doneMsg ? (
          <div className="search-busy dim">{doneMsg}</div>
        ) : status?.error ? (
          <div className="search-busy dim">{t('ایندکس متوقف شد: {error}', { error: status.error })}</div>
        ) : null}

        <div className="search-results" ref={list}>
          {q && hits.length === 0 && !status?.running && (
            <div className="dim search-empty">{t(t('چیزی پیدا نشد — اگر تازه اضافه شده، ایندکس را به‌روز کن'))}</div>
          )}
          {hits.map((h, i) => (
            <div
              key={h.path}
              className={'sr' + (i === at ? ' on' : '')}
              onMouseEnter={() => setAt(i)}
              onClick={() => onReveal(h)}
              onDoubleClick={() => onOpen(h)}
            >
              <span className="sr-ic">{h.dir ? <FolderIcon /> : <span className="sr-ext">{h.ext || '—'}</span>}</span>
              <span className="sr-name" dir="auto">
                {h.name}
              </span>
              <span className="sr-path dim" dir="auto">
                {h.path.slice(0, h.path.length - h.name.length - 1)}
              </span>
              <span className="sr-meta dim">{h.dir ? '' : fmtSize(h.size, false)}</span>
              <span className="sr-meta dim">{fmtDate(h.mtime)}</span>
            </div>
          ))}
        </div>

        <div className="search-foot dim">
          {t('↑↓ جابه‌جایی · Enter رفتن به پوشه · Ctrl+Enter باز کردن فایل · Esc بستن')}
        </div>
      </div>
    </div>
  )
}
