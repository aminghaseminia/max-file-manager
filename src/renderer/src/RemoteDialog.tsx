import { useEffect, useState, type ReactNode } from 'react'
import { t } from './i18n.ts'
import { api, type ProfileDraft, type RemoteProfile, type SshConfigHost } from './api'
import type { RemoteProtocol } from '../../shared/remote-profile.ts'
import { fa } from './format'
import { CloudIcon, LockIcon, PlusIcon, ServerIcon, XIcon } from './Icons'

type Props = {
  profiles: RemoteProfile[]
  /** a profile row selected when the dialog opens */
  initialId?: string
  onProfiles(list: RemoteProfile[]): void
  /** connect to a saved profile: the caller navigates its active pane and closes the dialog */
  onOpen(uri: string): void
  onClose(): void
}

type Form = {
  id?: string
  protocol: RemoteProtocol
  name: string
  host: string
  port: string
  user: string
  root: string
  anonymous: boolean
  implicitTLS: boolean
  verifyTls: boolean
  bucket: string
  region: string
  endpoint: string
  pathStyle: boolean
  accessKey: string
  password: string
  secretKey: string
  sessionToken: string
  auth: 'password' | 'key' | 'agent'
  keyPath: string
  keyPassphrase: string
  hostKey: string
  acceptNewHostKey: boolean
  hasSecret: boolean
  sessionOnly: boolean
}

const blank = (protocol: RemoteProtocol = 'ftp'): Form => ({
  protocol,
  name: '',
  host: '',
  port: protocol === 'sftp' ? '22' : '21',
  user: '',
  root: '/',
  anonymous: false,
  implicitTLS: false,
  verifyTls: true,
  bucket: '',
  region: 'us-east-1',
  endpoint: '',
  pathStyle: false,
  accessKey: '',
  password: '',
  secretKey: '',
  sessionToken: '',
  auth: 'password',
  keyPath: '',
  keyPassphrase: '',
  hostKey: '',
  acceptNewHostKey: true,
  hasSecret: false,
  sessionOnly: false
})

const fromProfile = (p: RemoteProfile): Form => ({
  id: p.id,
  protocol: p.protocol,
  name: p.name,
  host: p.host,
  port: String(p.port ?? (p.protocol === 'sftp' ? 22 : p.implicitTLS ? 990 : 21)),
  user: p.user ?? '',
  root: p.root || '/',
  anonymous: p.anonymous === true,
  implicitTLS: p.implicitTLS === true,
  verifyTls: p.verifyTls !== false,
  bucket: p.bucket ?? '',
  region: p.region || 'us-east-1',
  endpoint: p.endpoint ?? '',
  pathStyle: p.pathStyle === true,
  accessKey: p.accessKey ?? '',
  password: '',
  secretKey: '',
  sessionToken: '',
  auth: p.auth ?? (p.keyPath ? 'key' : 'password'),
  keyPath: p.keyPath ?? '',
  keyPassphrase: '',
  hostKey: p.hostKey ?? '',
  acceptNewHostKey: p.acceptNewHostKey !== false,
  hasSecret: p.hasSecret === true,
  sessionOnly: p.sessionOnly === true
})

function toDraft(f: Form): ProfileDraft {
  const draft: ProfileDraft = {
    id: f.id,
    protocol: f.protocol,
    name: f.name,
    verifyTls: f.verifyTls
  }
  if (f.protocol === 's3') {
    draft.bucket = f.bucket
    draft.region = f.region
    draft.endpoint = f.endpoint
    draft.pathStyle = f.pathStyle
    draft.accessKey = f.accessKey
    if (f.secretKey) draft.secretKey = f.secretKey
    if (f.sessionToken) draft.sessionToken = f.sessionToken
  } else if (f.protocol === 'sftp') {
    draft.host = f.host
    draft.port = Number(f.port) || undefined
    draft.user = f.user
    draft.root = f.root
    draft.auth = f.auth
    draft.keyPath = f.keyPath
    draft.hostKey = f.hostKey || undefined
    draft.acceptNewHostKey = f.acceptNewHostKey
    if (f.password) draft.password = f.password
    if (f.keyPassphrase) draft.keyPassphrase = f.keyPassphrase
  } else {
    draft.host = f.host
    draft.port = Number(f.port) || undefined
    draft.anonymous = f.anonymous
    draft.user = f.anonymous ? 'anonymous' : f.user
    draft.root = f.root
    draft.implicitTLS = f.protocol === 'ftps' ? f.implicitTLS : false
    if (f.password) draft.password = f.password
  }
  return draft
}

const protoName = (p: RemoteProtocol): string =>
  p === 's3' ? 'S3' : p === 'ftps' ? 'FTPS' : p === 'sftp' ? 'SFTP' : 'FTP'

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="dialog-field">
      <span>{t(label)}</span>
      {children}
      {hint && <small className="remote-hint">{t(hint)}</small>}
    </label>
  )
}

/**
 * Connection manager for FTP, FTPS, SFTP and S3. It only ever sees profile metadata: passwords,
 * access keys, key passphrases and host-key pins live in main; only non-secret metadata returns.
 */
export function RemoteDialog({ profiles, initialId, onProfiles, onOpen, onClose }: Props) {
  const [list, setList] = useState<RemoteProfile[]>(profiles)
  const [form, setForm] = useState<Form>(() => {
    const first = profiles.find((p) => p.id === initialId) ?? profiles[0]
    return first ? fromProfile(first) : blank()
  })
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [testOk, setTestOk] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [clearSecrets, setClearSecrets] = useState(false)
  const [sshHosts, setSshHosts] = useState<SshConfigHost[] | null>(null)
  const [sshBusy, setSshBusy] = useState(false)

  useEffect(() => {
    void api.remote
      .profiles()
      .then((rows) => {
        setList(rows)
        onProfiles(rows)
      })
      .catch(() => undefined)
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const patch = (p: Partial<Form>): void => {
    setForm((f) => ({ ...f, ...p }))
    setTestResult('')
    setError('')
  }

  const select = (p: RemoteProfile): void => {
    setForm(fromProfile(p))
    setConfirmDelete(false)
    setClearSecrets(false)
    setError('')
    setTestResult('')
  }

  const loadSshHosts = async (): Promise<void> => {
    setSshBusy(true)
    try {
      setSshHosts(await api.remote.sshConfig())
    } catch {
      setSshHosts([])
    } finally {
      setSshBusy(false)
    }
  }

  const applySshHost = (alias: string): void => {
    const hit = sshHosts?.find((h) => h.alias === alias)
    if (!hit) return
    patch({
      protocol: 'sftp',
      name: hit.alias,
      host: hit.host,
      port: String(hit.port),
      user: hit.user,
      root: '/',
      auth: hit.identityFile ? 'key' : 'password',
      keyPath: hit.identityFile,
      hostKey: '',
      acceptNewHostKey: true
    })
  }

  const forgetHostKey = async (): Promise<void> => {
    if (!form.id) {
      patch({ hostKey: '', acceptNewHostKey: true })
      return
    }
    await api.remote.forgetHostKey(form.id)
    patch({ hostKey: '', acceptNewHostKey: true })
    await reload(form.id)
  }

  const startNew = (): void => {
    setForm(blank(form.protocol))
    setConfirmDelete(false)
    setClearSecrets(false)
    setError('')
    setTestResult('')
  }

  const reload = async (keepId?: string): Promise<RemoteProfile[]> => {
    const rows = await api.remote.profiles()
    setList(rows)
    onProfiles(rows)
    if (keepId) {
      const hit = rows.find((p) => p.id === keepId)
      if (hit) setForm(fromProfile(hit))
    }
    return rows
  }

  const draft = (): ProfileDraft => {
    const d = toDraft(form)
    if (clearSecrets) {
      d.password = ''
      d.secretKey = ''
      d.sessionToken = ''
      d.keyPassphrase = ''
    }
    return d
  }

  const save = async (): Promise<RemoteProfile | null> => {
    setBusy(true)
    setError('')
    setTestResult('')
    try {
      const saved = await api.remote.save(draft())
      if (!saved.ok) {
        setError(saved.error)
        return null
      }
      setClearSecrets(false)
      await reload(saved.profile.id)
      return saved.profile
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  const test = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setTestResult('')
    try {
      const r = await api.remote.test(draft())
      if (r.ok) {
        setTestOk(true)
        setTestResult(r.detail)
      } else {
        setTestOk(false)
        setTestResult(r.error)
      }
    } catch (e) {
      setTestOk(false)
      setTestResult(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const connect = async (): Promise<void> => {
    // connect works from an unsaved form too: save first, so the tab has a profile to resolve
    const saved = await save()
    if (!saved) return
    // a failed login or an untrusted host key must keep the dialog open with the reason visible,
    // instead of closing it and leaving an error in the pane behind
    const check = await api.remote.testSaved(saved.id)
    if (!check.ok) {
      setTestOk(false)
      setError(check.error)
      return
    }
    const uri = await api.remote.uri(saved.id)
    if (uri) onOpen(uri)
  }

  const remove = async (): Promise<void> => {
    if (!form.id) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    try {
      await api.remote.remove(form.id)
      const rows = await reload()
      setConfirmDelete(false)
      if (rows.length) setForm(fromProfile(rows[0]))
      else startNew()
    } finally {
      setBusy(false)
    }
  }

  const ftpLike = form.protocol === 'ftp' || form.protocol === 'ftps'
  const sftpLike = form.protocol === 'sftp'
  const dirtySecret =
    form.password !== '' ||
    form.secretKey !== '' ||
    form.sessionToken !== '' ||
    form.keyPassphrase !== ''

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="dialog remote-dialog wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">
          <span>{t('اتصال‌های دور')}</span>
          <span className="dialog-sub">FTP · FTPS · SFTP · S3</span>
          <button type="button" className="dialog-x" title={t('بستن')} onClick={onClose}>
            <XIcon />
          </button>
        </div>

        <div className="remote-body">
          <aside className="remote-list">
            <button type="button" className="remote-new" onClick={startNew}>
              <PlusIcon size={12} />
              <span>{t('اتصال تازه')}</span>
            </button>
            {list.length === 0 && <div className="remote-empty">{t('هنوز اتصالی ذخیره نشده')}</div>}
            {list.map((p) => (
              <button
                type="button"
                key={p.id}
                className={'remote-row' + (form.id === p.id ? ' on' : '')}
                onClick={() => select(p)}
              >
                {p.protocol === 's3' ? <CloudIcon size={14} /> : <ServerIcon size={14} />}
                <span className="remote-row-main">
                  <span className="remote-row-name" dir="auto">
                    {p.name}
                  </span>
                  <span className="remote-row-sub" dir="ltr">
                    {protoName(p.protocol)} · {p.protocol === 's3' ? p.bucket : `${p.host}:${p.port}`}
                  </span>
                </span>
                {p.sessionOnly && <span className="remote-badge">{t('این نشست')}</span>}
                {p.hasSecret && !p.sessionOnly && <LockIcon size={11} />}
              </button>
            ))}
          </aside>

          <form
            className="remote-form"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="remote-fields">
            <div className="remote-grid">
              <Field label="نام اتصال">
                <input
                  value={form.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder={t('مثلاً فایل‌های شرکت')}
                  dir="auto"
                />
              </Field>
              <Field label="پروتکل">
                <select
                  value={form.protocol}
                  onChange={(e) => {
                    const p = e.target.value as RemoteProtocol
                    patch({
                      protocol: p,
                      port: p === 'sftp' ? '22' : p === 'ftps' && form.implicitTLS ? '990' : '21',
                      auth: p === 'sftp' ? form.auth : form.auth,
                      acceptNewHostKey: p === 'sftp' ? true : form.acceptNewHostKey
                    })
                  }}
                >
                  <option value="ftp">FTP</option>
                  <option value="ftps">FTPS (TLS)</option>
                  <option value="sftp">SFTP (SSH)</option>
                  <option value="s3">S3</option>
                </select>
              </Field>
            </div>

            {sftpLike ? (
              <>
                <div className="remote-import">
                  <button
                    type="button"
                    className="btn ghost mini"
                    disabled={sshBusy}
                    onClick={() => void loadSshHosts()}
                  >
                    {sshBusy ? t('در حال خواندن…') : t('واردکردن از ~/.ssh/config')}
                  </button>
                  {sshHosts && sshHosts.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => applySshHost(e.target.value)}
                      aria-label={t('میزبان‌های SSH')}
                    >
                      <option value="">{t('یک میزبان انتخاب کن…')}</option>
                      {sshHosts.map((h) => (
                        <option key={h.alias} value={h.alias}>
                          {h.alias} — {h.user}@{h.host}:{h.port}
                        </option>
                      ))}
                    </select>
                  )}
                  {sshHosts && sshHosts.length === 0 && (
                    <span className="remote-hint">{t('میزبانی در ~/.ssh/config پیدا نشد')}</span>
                  )}
                </div>
                <div className="remote-grid">
                  <Field label="میزبان">
                    <input
                      value={form.host}
                      onChange={(e) => patch({ host: e.target.value })}
                      placeholder="server.example.com"
                      dir="ltr"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label="درگاه">
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={form.port}
                      onChange={(e) => patch({ port: e.target.value })}
                      dir="ltr"
                    />
                  </Field>
                </div>
                <div className="remote-grid">
                  <Field label="کاربر">
                    <input
                      value={form.user}
                      onChange={(e) => patch({ user: e.target.value })}
                      dir="ltr"
                      autoComplete="username"
                    />
                  </Field>
                  <Field label="روش ورود">
                    <select
                      value={form.auth}
                      onChange={(e) => patch({ auth: e.target.value as Form['auth'] })}
                    >
                      <option value="password">{t('رمز عبور')}</option>
                      <option value="key">{t('کلید خصوصی')}</option>
                      <option value="agent">{t('عامل SSH (ssh-agent)')}</option>
                    </select>
                  </Field>
                </div>
                {form.auth === 'password' && (
                  <Field
                    label="رمز عبور"
                    hint={form.hasSecret && !dirtySecret ? 'ذخیره شده؛ برای تغییر بنویس' : undefined}
                  >
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => patch({ password: e.target.value })}
                      dir="ltr"
                      autoComplete="new-password"
                      placeholder={form.hasSecret ? '••••••••' : ''}
                    />
                  </Field>
                )}
                {form.auth === 'key' && (
                  <>
                    <Field label="کلید خصوصی" hint="مسیر فایل کلید؛ مثلاً ~/.ssh/id_ed25519">
                      <input
                        value={form.keyPath}
                        onChange={(e) => patch({ keyPath: e.target.value })}
                        placeholder="~/.ssh/id_ed25519"
                        dir="ltr"
                        spellCheck={false}
                      />
                    </Field>
                    <Field
                      label="رمز کلید (اختیاری)"
                      hint={form.hasSecret && !dirtySecret ? 'ذخیره شده؛ برای تغییر بنویس' : undefined}
                    >
                      <input
                        type="password"
                        value={form.keyPassphrase}
                        onChange={(e) => patch({ keyPassphrase: e.target.value })}
                        dir="ltr"
                        autoComplete="new-password"
                        placeholder={form.hasSecret ? '••••••••' : ''}
                      />
                    </Field>
                  </>
                )}
                {form.auth === 'agent' && (
                  <div className="remote-warn">
                    {t('کلید از ssh-agent همین کاربر استفاده می‌شود (SSH_AUTH_SOCK یا Pageant در ویندوز).')}
                  </div>
                )}
                <Field label="پوشهٔ شروع" hint="مسیر مطلق روی سرور؛ پیش‌فرض ریشه است">
                  <input
                    value={form.root}
                    onChange={(e) => patch({ root: e.target.value })}
                    dir="ltr"
                    spellCheck={false}
                  />
                </Field>
                {form.hostKey ? (
                  <div className="remote-hostkey">
                    <span className="remote-hint">{t('کلید میزبان ذخیره‌شده')}</span>
                    <code dir="ltr">{form.hostKey}</code>
                    <button type="button" className="btn ghost mini" onClick={() => void forgetHostKey()}>
                      {t('فراموش کردن')}
                    </button>
                  </div>
                ) : (
                  <label className="remote-check">
                    <input
                      type="checkbox"
                      checked={form.acceptNewHostKey}
                      onChange={(e) => patch({ acceptNewHostKey: e.target.checked })}
                    />
                    <span>{t('کلید میزبان ناشناس را بپذیر و ذخیره کن (TOFU)')}</span>
                  </label>
                )}
              </>
            ) : ftpLike ? (
              <>
                <div className="remote-grid">
                  <Field label="میزبان">
                    <input
                      value={form.host}
                      onChange={(e) => patch({ host: e.target.value })}
                      placeholder="ftp.example.com"
                      dir="ltr"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label="درگاه">
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={form.port}
                      onChange={(e) => patch({ port: e.target.value })}
                      dir="ltr"
                    />
                  </Field>
                </div>
                <label className="remote-check">
                  <input
                    type="checkbox"
                    checked={form.anonymous}
                    onChange={(e) => patch({ anonymous: e.target.checked })}
                  />
                  <span>{t('اتصال ناشناس (Anonymous)')}</span>
                </label>
                <div className="remote-grid">
                  <Field label="کاربر">
                    <input
                      value={form.user}
                      disabled={form.anonymous}
                      onChange={(e) => patch({ user: e.target.value })}
                      dir="ltr"
                      autoComplete="username"
                    />
                  </Field>
                  <Field
                    label="رمز عبور"
                    hint={form.hasSecret && !dirtySecret ? 'ذخیره شده؛ برای تغییر بنویس' : undefined}
                  >
                    <input
                      type="password"
                      value={form.password}
                      disabled={form.anonymous}
                      onChange={(e) => patch({ password: e.target.value })}
                      dir="ltr"
                      autoComplete="new-password"
                      placeholder={form.hasSecret ? '••••••••' : ''}
                    />
                  </Field>
                </div>
                <Field label="پوشهٔ شروع" hint="مسیر مطلق روی سرور؛ پیش‌فرض ریشه است">
                  <input
                    value={form.root}
                    onChange={(e) => patch({ root: e.target.value })}
                    dir="ltr"
                    spellCheck={false}
                  />
                </Field>
                {form.protocol === 'ftps' && (
                  <label className="remote-check">
                    <input
                      type="checkbox"
                      checked={form.implicitTLS}
                      onChange={(e) =>
                        patch({
                          implicitTLS: e.target.checked,
                          port: e.target.checked ? '990' : '21'
                        })
                      }
                    />
                    <span>{t('TLS ضمنی (درگاه ۹۹۰)')}</span>
                  </label>
                )}
              </>
            ) : (
              <>
                <div className="remote-grid">
                  <Field label="سطل (Bucket)">
                    <input
                      value={form.bucket}
                      onChange={(e) => patch({ bucket: e.target.value })}
                      placeholder="photos"
                      dir="ltr"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label="ناحیه (Region)">
                    <input
                      value={form.region}
                      onChange={(e) => patch({ region: e.target.value })}
                      placeholder="us-east-1"
                      dir="ltr"
                      spellCheck={false}
                    />
                  </Field>
                </div>
                <Field
                  label="نقطهٔ پایانی (اختیاری)"
                  hint="برای MinIO/Ceph؛ خالی یعنی Amazon S3"
                >
                  <input
                    value={form.endpoint}
                    onChange={(e) => patch({ endpoint: e.target.value })}
                    placeholder="https://minio.example.com:9000"
                    dir="ltr"
                    spellCheck={false}
                  />
                </Field>
                <div className="remote-grid">
                  <Field label="شناسهٔ دسترسی">
                    <input
                      value={form.accessKey}
                      onChange={(e) => patch({ accessKey: e.target.value })}
                      dir="ltr"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  <Field
                    label="کلید مخفی"
                    hint={form.hasSecret && !dirtySecret ? 'ذخیره شده؛ برای تغییر بنویس' : undefined}
                  >
                    <input
                      type="password"
                      value={form.secretKey}
                      onChange={(e) => patch({ secretKey: e.target.value })}
                      dir="ltr"
                      autoComplete="new-password"
                      placeholder={form.hasSecret ? '••••••••' : ''}
                    />
                  </Field>
                </div>
                <Field label="توکن نشست (اختیاری)">
                  <input
                    type="password"
                    value={form.sessionToken}
                    onChange={(e) => patch({ sessionToken: e.target.value })}
                    dir="ltr"
                    autoComplete="off"
                  />
                </Field>
                <label className="remote-check">
                  <input
                    type="checkbox"
                    checked={form.pathStyle}
                    onChange={(e) => patch({ pathStyle: e.target.checked })}
                  />
                  <span>{t('آدرس‌دهی مسیر (Path-style)')}</span>
                </label>
              </>
            )}

            {!sftpLike && (
              <label className="remote-check">
                <input
                  type="checkbox"
                  checked={form.verifyTls}
                  onChange={(e) => patch({ verifyTls: e.target.checked })}
                />
                <span>{t('بررسی گواهی TLS')}</span>
              </label>
            )}

            {form.hasSecret && (
              <label className="remote-check">
                <input
                  type="checkbox"
                  checked={clearSecrets}
                  onChange={(e) => setClearSecrets(e.target.checked)}
                />
                <span>{t('رمز ذخیره‌شده پاک شود')}</span>
              </label>
            )}
            {form.sessionOnly && (
              <div className="remote-warn">
                {t('جاکلیدی سیستم در دسترس نیست؛ رمز فقط تا بستن برنامه نگه داشته می‌شود.')}
              </div>
            )}

            {(testResult || error) && (
              <div className={'remote-result' + (testOk && !error ? ' ok' : ' bad')} dir="auto">
                {error || testResult}
              </div>
            )}
            </div>

            <div className="dialog-actions remote-actions">
              {form.id && (
                <button
                  type="button"
                  className={'remote-danger' + (confirmDelete ? ' armed' : '')}
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  {confirmDelete ? t('تأیید حذف') : t('حذف')}
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => void test()}>
                {busy ? t('در حال بررسی…') : t('آزمایش')}
              </button>
              <span className="remote-spacer" />
              <button type="button" onClick={onClose}>
                {t('بستن')}
              </button>
              <button type="submit" disabled={busy}>
                {t('ذخیره')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void connect()}
              >
                {t('باز کردن اتصال')}
              </button>
            </div>
          </form>
        </div>
        <div className="remote-foot">
          {t('رمزها با جاکلیدی سیستم رمزگذاری می‌شوند و هرگز به رابط کاربری برنمی‌گردند.')}
          {list.length > 0 && <span> · {t('{n} اتصال', { n: fa(list.length) })}</span>}
        </div>
      </div>
    </div>
  )
}
