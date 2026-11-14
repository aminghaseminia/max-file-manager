import { t } from './i18n.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type DesktopApp } from './api'
import { baseName, matchCustomCommand, mediaUrl } from './format'
import { PlayIcon, StarIcon } from './Icons'
import type { CustomCommand } from './prefs'

type Props = {
  path: string
  customCommands?: CustomCommand[]
  isDir?: boolean
  onClose(): void
  onNote(msg: string): void
  /** «remember» was ticked: the caller stores the per-extension override as well */
  onRemember?(app: { id: string; name: string }): void
}

const extOf = (p: string): string => (p.includes('.') ? (p.split('.').pop() ?? '').toLowerCase() : '')

/**
 * Dolphin-class «Open with»: every application that claims the type (or all of them), with its
 * icon, the desktop's current handler marked, a filter box, and «remember this choice».
 */
export function OpenWithDialog({ path, customCommands, isDir, onClose, onNote, onRemember }: Props) {
  const [apps, setApps] = useState<DesktopApp[] | null>(null)
  const [mime, setMime] = useState('')
  const [canSetDefault, setCanSetDefault] = useState(false)
  const [all, setAll] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    setApps(null)
    void api.apps
      .openWith(path, all)
      .then((r) => {
        if (!live) return
        setApps(r.apps)
        setMime(r.mime)
        setCanSetDefault(r.canSetDefault)
        setSelected(0)
      })
      .catch(() => live && setApps([]))
    return () => {
      live = false
    }
  }, [path, all])

  const matchingCustom = (customCommands ?? []).filter((c) => matchCustomCommand(c, path, !!isDir))

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !apps) return apps ?? []
    return apps.filter((a) => a.name.toLowerCase().includes(q))
  }, [apps, query])

  useEffect(() => {
    if (selected >= shown.length) setSelected(Math.max(0, shown.length - 1))
  }, [shown.length, selected])

  const rememberChoice = async (id: string, name: string): Promise<void> => {
    if (!remember || isDir || !canSetDefault) return
    const r = await api.apps.setDefault(path, id)
    if ('error' in r) {
      onNote(`${t('ثبت برنامهٔ پیش‌فرض ممکن نشد')}: ${r.error}`)
      return
    }
    const ext = extOf(path)
    if (ext) onRemember?.({ id, name })
  }

  const launch = async (app: DesktopApp) => {
    if (busy) return
    setBusy(true)
    await rememberChoice(app.id, app.name)
    const result = await api.apps.launch(app.id, path)
    onClose()
    if ('error' in result) onNote(t('برنامه باز نشد'))
  }

  const launchCustom = async (cmd: CustomCommand) => {
    onClose()
    const result = await api.runCustomCommand(cmd.command, path)
    if ('error' in result) onNote(`${cmd.label}: ${result.error}`)
  }

  const systemDefault = async () => {
    const result = await api.open(path)
    onClose()
    if ('error' in result) onNote(t('برنامهٔ پیش‌فرض این فایل را باز نکرد'))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const inField = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'Enter' && !inField) {
        const app = shown[selected]
        if (app) {
          e.preventDefault()
          void launch(app)
        }
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!shown.length) return
        e.preventDefault()
        const next = Math.max(0, Math.min(shown.length - 1, selected + (e.key === 'ArrowDown' ? 1 : -1)))
        setSelected(next)
        listRef.current?.querySelectorAll('.open-with-row[data-app]')[next]?.scrollIntoView({ block: 'nearest' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="modal" onMouseDown={onClose}>
      <div
        className="dialog open-with"
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-with-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-title">
          <span id="open-with-title">{t('باز کردن با…')}</span>
          <span className="dialog-sub" dir="auto" title={path}>
            {baseName(path)}
          </span>
        </div>

        <div className="open-with-tools">
          <input
            ref={searchRef}
            className="open-with-search"
            type="search"
            dir="auto"
            autoFocus
            placeholder={t('جست‌وجوی برنامه…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const app = shown[selected]
                if (app) void launch(app)
              }
            }}
          />
          <div className="seg open-with-scope">
            <button className={all ? '' : 'on'} onClick={() => setAll(false)}>
              {t('پیشنهادی')}
            </button>
            <button className={all ? 'on' : ''} onClick={() => setAll(true)}>
              {t('همهٔ برنامه‌ها')}
            </button>
          </div>
        </div>
        {mime && (
          <div className="open-with-mime" dir="ltr">
            {mime}
          </div>
        )}

        <div className="open-with-list" ref={listRef}>
          {matchingCustom.length > 0 && (
            <div className="open-with-custom-section">
              <div className="open-with-section">{t('دستورهای سفارشی')}</div>
              {matchingCustom.map((cmd) => (
                <button key={cmd.id} className="open-with-row" onClick={() => void launchCustom(cmd)}>
                  <span className="open-with-icon">
                    <PlayIcon />
                  </span>
                  <span className="open-with-name" dir="auto">
                    {cmd.label}
                  </span>
                  <span className="open-with-hint" dir="ltr">
                    {cmd.command}
                  </span>
                </button>
              ))}
            </div>
          )}

          {apps === null && <p className="hint">{t('در حال خواندن برنامه‌ها…')}</p>}
          {apps?.length === 0 && matchingCustom.length === 0 && (
            <p className="hint">{t('برنامه‌ای برای این نوع فایل پیدا نشد.')}</p>
          )}
          {apps !== null && apps.length > 0 && shown.length === 0 && (
            <p className="hint">{t('برنامه‌ای با این نام نیست')}</p>
          )}

          {shown.map((app, i) => (
            <button
              key={app.id}
              data-app="1"
              className={`open-with-row${i === selected ? ' on' : ''}`}
              onClick={() => setSelected(i)}
              onDoubleClick={() => void launch(app)}
              title={app.id}
            >
              <span className="open-with-icon">
                {app.iconPath ? (
                  <img src={mediaUrl(app.iconPath)} alt="" width={22} height={22} draggable={false} />
                ) : (
                  <PlayIcon />
                )}
              </span>
              <span className="open-with-name" dir="auto">
                {app.name}
              </span>
              {app.isDefault && (
                <span className="open-with-badge" title={t('پیش‌فرض سیستم')}>
                  <StarIcon filled size={11} />
                  {t('پیش‌فرض')}
                </span>
              )}
            </button>
          ))}
        </div>

        {canSetDefault && (
          <label className="open-with-remember">
            <input
              type="checkbox"
              checked={remember}
              disabled={isDir}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>
              {t('همیشه با این برنامه باز کن')}
              {isDir ? ` — ${t('برای پوشه‌ها نیست')}` : mime ? ` (${mime})` : ''}
            </span>
          </label>
        )}

        <div className="dialog-actions">
          <button className="btn ghost" onClick={() => void systemDefault()}>
            {t('برنامهٔ پیش‌فرض سیستم')}
          </button>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            {t('لغو')}
          </button>
          <button
            className="btn"
            disabled={!shown[selected] || busy}
            onClick={() => {
              const app = shown[selected]
              if (app) void launch(app)
            }}
          >
            {t('باز کردن')}
          </button>
        </div>
      </div>
    </div>
  )
}
