import { t } from './i18n.ts'
import { useEffect, useState } from 'react'
import { api } from './api'
import { baseName } from './format'
import { PlayIcon } from './Icons'

type Props = {
  path: string
  onClose(): void
  onNote(msg: string): void
}

/** The desktop's «Open with» list: the .desktop files that claim this MIME type. */
export function OpenWithDialog({ path, onClose, onNote }: Props) {
  const [apps, setApps] = useState<{ id: string; name: string }[] | null>(null)

  useEffect(() => {
    void api.apps.list(path).then(setApps).catch(() => setApps([]))
  }, [path])

  const launch = async (id: string) => {
    const result = await api.apps.launch(id, path)
    onClose()
    if ('error' in result) onNote(t('برنامه باز نشد'))
  }

  const systemDefault = async () => {
    const result = await api.open(path)
    onClose()
    if ('error' in result) onNote(t('برنامهٔ پیش‌فرض این فایل را باز نکرد'))
  }

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

        <div className="open-with-list">
          {apps === null && <p className="hint">{t('در حال خواندن برنامه‌ها…')}</p>}
          {apps?.length === 0 && <p className="hint">{t('برنامه‌ای برای این نوع فایل پیدا نشد.')}</p>}
          {apps?.map((app) => (
            <button key={app.id} className="open-with-row" onClick={() => void launch(app.id)}>
              <span className="open-with-icon">
                <PlayIcon />
              </span>
              <span className="open-with-name" dir="auto">
                {app.name}
              </span>
            </button>
          ))}
        </div>

        <div className="dialog-actions">
          <button className="btn ghost" onClick={() => void systemDefault()}>
            {t('برنامهٔ پیش‌فرض سیستم')}
          </button>
          <button className="btn ghost" onClick={onClose}>
            {t('بستن')}
          </button>
        </div>
      </div>
    </div>
  )
}
