import { useState } from 'react'
import { t } from './i18n.ts'
import { api } from './api'
import { baseName, dirOf, joinPath } from './format'

type Props = {
  /** the file/folder the link points at */
  target: string
  onDone(linkPath: string): void
  onClose(): void
}

/** Creates a symbolic link in the same folder as the target, without ever overwriting. */
export function SymlinkDialog({ target, onDone, onClose }: Props) {
  const dir = dirOf(target)
  const [name, setName] = useState(`${baseName(target)} - link`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async (): Promise<void> => {
    const clean = name.trim()
    if (!clean || /[\\/]/.test(clean) || clean === '.' || clean === '..') {
      setError(t('نام نامعتبر است'))
      return
    }
    setBusy(true)
    setError('')
    const r = await api.symlink(target, joinPath(dir, clean))
    setBusy(false)
    if (r.ok) onDone(r.path)
    else setError(r.error)
  }

  const message = error.includes('Developer Mode')
    ? t('در ویندوز برای پیوند فایل باید Developer Mode روشن باشد یا برنامه با دسترسی مدیر اجرا شود')
    : error

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dlg-title">{t('ایجاد پیوند نمادین')}</div>

        <label className="field">
          <span>{t('مقصد پیوند')}</span>
          <input dir="ltr" value={target} readOnly />
        </label>

        <label className="field">
          <span>{t('نام پیوند')}</span>
          <input
            autoFocus
            dir="auto"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'Enter') void create()
            }}
          />
        </label>

        <div className="hint">
          {t(
            'پیوند در همان پوشهٔ مقصد ساخته می‌شود؛ در ویندوز پوشه‌ها به‌صورت junction و بدون دسترسی مدیر ساخته می‌شوند'
          )}
        </div>
        {message && <div className="warn">{message}</div>}

        <div className="dlg-actions">
          <button disabled={busy || !name.trim()} onClick={() => void create()}>
            {busy ? t('در حال ساخت…') : t('ساخت پیوند')}
          </button>
          <button onClick={onClose}>{t('انصراف')}</button>
        </div>
      </div>
    </div>
  )
}
