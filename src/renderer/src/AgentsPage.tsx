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
    setBusy('در حال اعمال…')
    const r = await api.mcp.configure(patch)
    setToken(r.token)
    setBusy(r.running ? `سرور روی 127.0.0.1:${r.port} فعال است (${r.mode})` : 'سرور خاموش است')
    load()
  }

  return (
    <>
      <div className="hint">
        با فعال‌کردن این بخش، ایجنت‌های دیگر (Claude Code، Codex، opencode، هر کلاینت MCP) می‌توانند
        از طریق پل stdio همین امکانات را صدا بزنند. پیش‌فرض «خاموش» و حالت «فقط خواندن» است.
      </div>

      <div className="pref-row">
        <div className="pref-label">
          <span>دسترسی ایجنت‌ها</span>
          <span className="hint">فقط روی 127.0.0.1 و با توکن</span>
        </div>
        <div className="pref-control">
          <div className="seg">
            {(['off', 'read', 'write'] as const).map((m) => (
              <button
                key={m}
                className={st?.mode === m ? 'on' : ''}
                onClick={() => void configure({ mode: m })}
              >
                {m === 'off' ? 'خاموش' : m === 'read' ? 'فقط خواندن' : 'خواندن و نوشتن'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="pref-row">
        <div className="pref-label">
          <span>توکن</span>
          <span className="hint">فایل {st ? 'mcp.json' : '…'} با دسترسی 600</span>
        </div>
        <div className="pref-control">
          <code className="token-box" dir="ltr">
            {token || (st?.hasToken ? '•••••••••••• (ذخیره شده)' : 'ساخته نشده')}
          </code>
          <button
            className="btn ghost"
            onClick={() =>
              void api.mcp.token().then((t) => {
                setToken(t)
                setBusy('توکن تازه ساخته شد؛ کلاینت‌ها را به‌روز کن')
                load()
              })
            }
          >
            توکن تازه
          </button>
        </div>
      </div>

      {busy && <div className="hint">{busy}</div>}

      <div className="hint">
        اتصال کلاینت: <code dir="ltr">{'{"mcpServers":{"max-file-manager":{"command":"node","args":["'}</code>
        <code dir="ltr">{'/path/to/bin/mfm-mcp.mjs'}</code>
        <code dir="ltr">{'"]}}}'}</code>
      </div>

      <div className="pref-label">
        <span>آخرین فراخوانی‌ها (لاگ دسترسی)</span>
      </div>
      <div className="mcp-log" dir="ltr">
        {(st?.log ?? []).slice().reverse().map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        {!st?.log?.length && <div className="dim">هنوز چیزی ثبت نشده</div>}
      </div>
    </>
  )
}
