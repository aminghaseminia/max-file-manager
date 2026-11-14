import { t } from './i18n.ts'
import { useEffect, useState } from 'react'
import { api } from './api'

type Status = { mode: 'off' | 'read' | 'write'; port: number; hasToken: boolean; log: string[] }

/** Agent access (MCP): off by default, read-only by default, token and audit log in view. */
export function AgentsPage() {
  const [st, setSt] = useState<Status | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState('')

  const load = () => void api.mcp.status().then(setSt)
  useEffect(load, [])

  const configure = async (patch: { mode?: 'off' | 'read' | 'write'; port?: number }) => {
    setBusy(t('در حال اعمال…'))
    const r = await api.mcp.configure(patch)
    setToken(r.token)
    setBusy(
      r.error
        ? t('سرور بالا نیامد: {error} — احتمالاً پورت {port} توسط برنامهٔ دیگری گرفته شده است', {
            error: r.error,
            port: String(r.port)
          })
        : r.running
          ? `سرور روی 127.0.0.1:${r.port} فعال است (${r.mode})`
          : t('سرور خاموش است')
    )
    load()
  }

  return (
    <>
      <div className="hint">
        {t('با فعال‌کردن این بخش، ایجنت‌های دیگر (Claude Code، Codex، opencode، هر کلاینت MCP) می‌توانند از طریق پل stdio همین امکانات را صدا بزنند. پیش‌فرض «خاموش» و حالت «فقط خواندن» است.')}
      </div>

      <div className="pref-row">
        <div className="pref-label">
          <span>{t(t('دسترسی ایجنت‌ها'))}</span>
          <span className="hint">{t(t('فقط روی 127.0.0.1 و با توکن'))}</span>
        </div>
        <div className="pref-control">
          <div className="seg">
            {(['off', 'read', 'write'] as const).map((m) => (
              <button
                key={m}
                className={st?.mode === m ? 'on' : ''}
                onClick={() => void configure({ mode: m })}
              >
                {m === 'off' ? t('خاموش') : m === 'read' ? t('فقط خواندن') : t('خواندن و نوشتن')}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="pref-row">
        <div className="pref-label">
          <span>{t(t('توکن'))}</span>
          <span className="hint">{t('فایل')} {st ? 'mcp.json' : '…'} {t('با دسترسی 600')}</span>
        </div>
        <div className="pref-control">
          <code className="token-box" dir="ltr">
            {token || (st?.hasToken ? t('•••••••••••• (ذخیره شده)') : t('ساخته نشده'))}
          </code>
          <button
            className="btn ghost"
            onClick={() =>
              void api.mcp.token().then((tok) => {
                setToken(tok)
                setBusy(t('توکن تازه ساخته شد؛ کلاینت‌ها را به‌روز کن'))
                load()
              })
            }
          >
            {t('توکن تازه')}
          </button>
        </div>
      </div>

      {busy && <div className="hint">{busy}</div>}

      <div className="hint">
        {t('اتصال کلاینت:')} <code dir="ltr">{'{"mcpServers":{"max-file-manager":{"command":"node","args":["'}</code>
        <code dir="ltr">{'/path/to/bin/mfm-mcp.mjs'}</code>
        <code dir="ltr">{'"]}}}'}</code>
      </div>

      <div className="pref-label">
        <span>{t(t('آخرین فراخوانی‌ها (لاگ دسترسی)'))}</span>
      </div>
      <div className="mcp-log" dir="ltr">
        {(st?.log ?? []).slice().reverse().map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        {!st?.log?.length && <div className="dim">{t(t('هنوز چیزی ثبت نشده'))}</div>}
      </div>
    </>
  )
}
