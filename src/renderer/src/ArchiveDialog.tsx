import { t } from './i18n.ts'
import { useState } from 'react'
import { baseName, fa } from './format'
import { XIcon } from './Icons'

export type ArchiveJob = {
  mode: 'compress' | 'extract'
  /** items to compress */
  files: string[]
  /** archive to extract */
  path: string
  name: string
  here: string
  other: string
  level: number
}

type Props = {
  job: ArchiveJob
  busy: boolean
  result: string
  onRun(opts: { name: string; level: number; dest: string }): void
  onClose(): void
}

/** Compress the selection, or unpack one archive — same dialog, one form each. */
export function ArchiveDialog({ job, busy, result, onRun, onClose }: Props) {
  const [name, setName] = useState(job.name)
  const [level, setLevel] = useState(job.level)
  const [dest, setDest] = useState(job.here)
  const compress = job.mode === 'compress'

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="dialog wide archive-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">
          <span>{compress ? t('فشرده‌سازی') : t('استخراج')}</span>
          <span className="dialog-sub" dir="auto" title={compress ? job.files[0] : job.path}>
            {compress
              ? t('{n} مورد', { n: fa(job.files.length) })
              : baseName(job.path)}
          </span>
        </div>

        {compress ? (
          <>
            <div className="pref-row">
              <div className="pref-label">
                <span>{t('نام آرشیو')}</span>
                <span className="hint">{t('پسوند zip خودکار اضافه می‌شود')}</span>
              </div>
              <div className="pref-control">
                <input
                  className="pref-input wide"
                  dir="auto"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim()) onRun({ name, level, dest })
                  }}
                />
              </div>
            </div>
            <div className="pref-row">
              <div className="pref-label">
                <span>{t('سطح فشرده‌سازی')}</span>
                <span className="hint">{t('بیشتر = کوچک‌تر ولی کندتر')}</span>
              </div>
              <div className="pref-control">
                <div className="seg">
                  {[
                    { v: 1, label: t('سریع') },
                    { v: 6, label: t('عادی') },
                    { v: 9, label: t('حداکثر') }
                  ].map((o) => (
                    <button key={o.v} className={level === o.v ? 'on' : ''} onClick={() => setLevel(o.v)}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="hint">
            {t('همهٔ فایل‌های این آرشیو در پوشهٔ انتخابی باز می‌شوند؛ نام تکراری بازنویسی نمی‌شود.')}
          </div>
        )}

        <div className="pref-row">
          <div className="pref-label">
            <span>{t('مقصد')}</span>
            <span className="hint" dir="auto">
              {dest}
            </span>
          </div>
          <div className="pref-control">
            <div className="seg">
              <button className={dest === job.here ? 'on' : ''} onClick={() => setDest(job.here)}>
                {t('همین پوشه')}
              </button>
              <button className={dest === job.other ? 'on' : ''} onClick={() => setDest(job.other)}>
                {t('پنجرهٔ مقابل')}
              </button>
            </div>
          </div>
        </div>

        {result && <div className="dim result-line">{result}</div>}

        <div className="dialog-actions">
          <button className="btn ghost" onClick={onClose}>
            <XIcon size={11} /> {t('بستن')}
          </button>
          <button
            className="btn"
            disabled={busy || (compress && !name.trim())}
            onClick={() => onRun({ name: name.trim(), level, dest })}
          >
            {busy ? t('در حال انجام…') : compress ? t('فشرده کن') : t('استخراج کن')}
          </button>
        </div>
      </div>
    </div>
  )
}
