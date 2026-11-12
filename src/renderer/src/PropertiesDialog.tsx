import { t } from './i18n.ts'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, type Entry, type FileProperties } from './api'
import {
  baseName,
  dirOf,
  fa,
  fmtDate,
  fmtSize,
  isImage,
  modeString,
  permLevel,
  permMode,
  thumbUrl,
  typeLabel
} from './format'
import { EntryIcon } from './Icons'
import { OpenWithDialog } from './OpenWithDialog'

type TabId = 'general' | 'permissions' | 'checksums' | 'details'

/** Labels are Persian source strings so `t()` can translate them at render time. */
const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'عمومی' },
  { id: 'permissions', label: 'دسترسی‌ها' },
  { id: 'checksums', label: 'چکیده' },
  { id: 'details', label: 'جزئیات' }
]

const ALGOS: { id: string; label: string }[] = [
  { id: 'md5', label: 'MD5' },
  { id: 'sha1', label: 'SHA-1' },
  { id: 'sha256', label: 'SHA-256' },
  { id: 'sha512', label: 'SHA-512' }
]

const GROUPS = ['owner', 'group', 'others'] as const

const normalizeHash = (s: string): string => s.trim().toLowerCase().replace(/[^0-9a-f]/g, '')

type Props = {
  path: string
  onClose(): void
  onNote(msg: string): void
  /** a rename inside the dialog moved the entry; the caller reloads that path */
  onPathChange?(next: string): void
  /** mode/label/stars/note changed: the listing behind the sheet has to be re-read */
  onUpdate?(): void
  /** folders only: open the colour/icon picker for this folder */
  onChangeIcon?(): void
}

/** Dolphin-style «Properties»: general, permissions, checksums and details. */
export function PropertiesDialog({
  path,
  onClose,
  onNote,
  onPathChange,
  onUpdate,
  onChangeIcon
}: Props) {
  const [tab, setTab] = useState<TabId>('general')
  const [data, setData] = useState<FileProperties | null>(null)
  const [failed, setFailed] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [defaultApp, setDefaultApp] = useState<{ id: string; name: string } | null>(null)
  const [openWith, setOpenWith] = useState(false)
  const [iconSet, setIconSet] = useState<Record<string, string>>({})

  const [hashes, setHashes] = useState<Record<string, string>>({})
  const [hashing, setHashing] = useState<string | null>(null)
  const [expected, setExpected] = useState('')

  const [octal, setOctal] = useState('')
  const [stars, setStars] = useState(0)
  const [label, setLabel] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [palette, setPalette] = useState<{ id: string; name: string; color: string }[]>([])
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => {
    setData(null)
    setFailed(false)
    setHashes({})
    setExpected('')
    void api
      .properties(path)
      .then((r) => ('error' in r ? setFailed(true) : setData(r)))
      .catch(() => setFailed(true))
  }, [path])

  useEffect(() => {
    void api.apps.default(path).then(setDefaultApp).catch(() => setDefaultApp(null))
  }, [path])

  useEffect(() => {
    void api.iconSet().then(setIconSet).catch(() => setIconSet({}))
  }, [])

  // labels, stars and the note live in the folder's own .mfm.json
  useEffect(() => {
    let alive = true
    const dir = dirOf(path)
    const name = baseName(path)
    void Promise.all([
      api.getMeta(dir).catch(() => null),
      api.labelPalette().catch(() => [])
    ]).then(([meta, pal]) => {
      if (!alive) return
      setStars(meta?.ratings?.[name] ?? 0)
      setNoteText(meta?.notes?.[name] ?? '')
      setLabel(meta?.labels?.[name] ?? null)
      setPalette(pal)
    })
    return () => {
      alive = false
    }
  }, [path])

  useEffect(() => {
    setNameDraft(data?.name ?? '')
    setOctal(data ? (data.mode & 0o777).toString(8).padStart(3, '0') : '')
  }, [data?.name, data?.mode])

  const entry = useMemo<Entry | null>(
    () =>
      data
        ? { name: data.name, path: data.path, dir: data.dir, size: data.size, mtime: data.mtime, ext: data.ext }
        : null,
    [data]
  )

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      onNote(`${t('کپی شد')}: ${what}`)
    } catch {
      onNote(text)
    }
  }

  const rename = async () => {
    if (!data) return
    const next = nameDraft.trim()
    if (!next || next === data.name) {
      setNameDraft(data.name)
      return
    }
    if (/[\\/]/.test(next)) {
      onNote(t('نام نامعتبر است'))
      setNameDraft(data.name)
      return
    }
    const sep = path.startsWith('/') ? '/' : '\\'
    const target = `${dirOf(path)}${sep}${next}`
    const taken = await api.properties(target)
    if (!('error' in taken)) {
      onNote(t('نام تکراری است'))
      setNameDraft(data.name)
      return
    }
    const r = await api.renameMany([{ from: path, to: target }])
    if (!r.done) {
      onNote(r.errors[0] ? `${t('تغییر نام انجام نشد')}: ${r.errors[0]}` : t('تغییر نام انجام نشد'))
      setNameDraft(data.name)
      return
    }
    onNote(`${t('تغییر نام')}: ${next}`)
    onPathChange?.(target)
  }

  const applyMode = async (mode: number) => {
    if (!data) return
    const next = mode & 0o777
    if (next === data.mode) return
    const r = await api.chmod(data.path, next)
    if ('error' in r) {
      onNote(t('تغییر دسترسی انجام نشد'))
      return
    }
    setData({ ...data, mode: next })
    onUpdate?.()
  }

  const applyOctal = async () => {
    if (!/^[0-7]{3}$/.test(octal)) {
      onNote(t('عدد مجوز نامعتبر است'))
      return
    }
    await applyMode(parseInt(octal, 8))
  }

  const compute = async (algo: string) => {
    if (!data) return
    setHashing(algo)
    const [r] = await api.hash([data.path], algo)
    setHashing(null)
    if (r?.hash) setHashes((h) => ({ ...h, [algo]: r.hash as string }))
    else onNote(t('چکیده محاسبه نشد'))
  }

  const pasteExpected = async () => {
    try {
      setExpected((await navigator.clipboard.readText()).trim())
    } catch {
      onNote(t('خواندن کلیپ‌بورد ممکن نشد'))
    }
  }

  const saveLabel = async (id: string | null) => {
    const dir = dirOf(path)
    const name = baseName(path)
    const next = id === label ? null : id
    await api.setLabel(dir, name, next)
    setLabel(next)
    onUpdate?.()
  }

  const saveStars = async (n: number) => {
    const value = stars === n ? 0 : n
    await api.setRating(dirOf(path), baseName(path), value)
    setStars(value)
    onUpdate?.()
  }

  const saveNote = async () => {
    if (!data) return
    setSavingNote(true)
    await api.setNote(dirOf(path), baseName(path), noteText)
    setSavingNote(false)
    onNote(t('ذخیره شد'))
    onUpdate?.()
  }

  const row = (key: string, value: ReactNode, ltr = false) => (
    <div className="prop-row">
      <span className="prop-key">{key}</span>
      <span className={'prop-value' + (ltr ? ' ltr' : '')} dir={ltr ? 'ltr' : 'auto'}>
        {value}
      </span>
    </div>
  )

  const sizeText = (d: FileProperties): string =>
    d.dir
      ? t('{n} مورد', { n: fa(d.items ?? 0) })
      : `${fmtSize(d.size, false, 'human')} (${fa(d.size)} ${t('بایت')})`

  const icon =
    data && !data.dir && isImage(data.ext) ? (
      <img src={thumbUrl(data.path, 96)} alt="" draggable={false} />
    ) : entry ? (
      <EntryIcon entry={entry} size={54} iconSet={iconSet} />
    ) : null

  const general = (d: FileProperties) => (
    <>
      <div className="prop-row">
        <span className="prop-key">{t('نام')}</span>
        <span className="prop-value">
          <input
            className="prop-input"
            dir="auto"
            spellCheck={false}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void rename()
              }
              if (e.key === 'Escape') setNameDraft(d.name)
            }}
          />
        </span>
      </div>
      {row(t('نوع'), entry ? typeLabel(entry) : d.ext.toUpperCase())}
      {row(t('نوع محتوا'), d.mime || '—', true)}
      <div className="prop-row">
        <span className="prop-key">{t('باز کردن با')}</span>
        <span className="prop-value" dir="auto">
          {defaultApp?.name ?? t('برنامه‌ای پیدا نشد')}
        </span>
        <button className="btn ghost mini" onClick={() => setOpenWith(true)}>
          {t('تغییر…')}
        </button>
      </div>
      <div className="prop-row">
        <span className="prop-key">{t('مکان')}</span>
        <span className="prop-value ltr" dir="ltr" title={d.path}>
          {d.path}
        </span>
        <button className="btn ghost mini" onClick={() => void copy(d.path, t('مسیر'))}>
          {t('کپی')}
        </button>
      </div>
      {row(t('اندازه'), sizeText(d))}
      {d.dims && row(t('ابعاد'), `${fa(d.dims.w)} × ${fa(d.dims.h)} ${t('پیکسل')}`)}
      {d.link && row(t('مقصد پیوند'), d.target || '—', true)}
      {row(t('ساخته‌شده'), fmtDate(d.birthtime, 'iso', true), true)}
      {row(t('تغییر یافته'), fmtDate(d.mtime, 'iso', true), true)}
      {row(t('آخرین دسترسی'), fmtDate(d.atime, 'iso', true), true)}
    </>
  )

  const permissions = (d: FileProperties) => (
    <>
      <table className="perm-table">
        <thead>
          <tr>
            <th />
            <th>{t('می‌تواند مشاهده و تغییر دهد')}</th>
            <th>{t('فقط می‌تواند مشاهده کند')}</th>
          </tr>
        </thead>
        <tbody>
          {([0, 1, 2] as const).map((i) => {
            const cls = GROUPS[i]
            return (
            <tr key={cls}>
              <td>{t(cls === 'owner' ? 'مالک' : cls === 'group' ? 'گروه' : 'بقیه')}</td>
              <td>
                <input
                  type="radio"
                  name={`perm-${cls}`}
                  checked={permLevel(d.mode, i) === 'rw'}
                  onChange={() => void applyMode(permMode(d.mode, i, 'rw', d.dir))}
                />
              </td>
              <td>
                <input
                  type="radio"
                  name={`perm-${cls}`}
                  checked={permLevel(d.mode, i) === 'r'}
                  onChange={() => void applyMode(permMode(d.mode, i, 'r', d.dir))}
                />
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
      <label className="check perm-exec">
        <input
          type="checkbox"
          checked={(d.mode & 0o111) !== 0}
          onChange={(e) => void applyMode(e.target.checked ? d.mode | 0o111 : d.mode & ~0o111)}
        />
        <span>{t('قابل اجراست')}</span>
      </label>

      <div className="prop-section">
        <h4>{t('مالکیت')}</h4>
        {row(t('کاربر'), `${d.user} (${fa(d.uid)})`)}
        {row(t('گروه'), `${d.group} (${fa(d.gid)})`)}
        <p className="hint">{t('تغییر مالکیت به دسترسی مدیر نیاز دارد')}</p>
      </div>

      <div className="prop-section">
        <h4>{t('مجوزهای پیشرفته')}</h4>
        <div className="prop-row">
          <span className="prop-key">{t('مجوز')}</span>
          <span className="prop-value">
            <input
              className="prop-input mono short"
              dir="ltr"
              maxLength={3}
              value={octal}
              onChange={(e) => setOctal(e.target.value.replace(/[^0-7]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void applyOctal()
              }}
            />
            <span className="perm-mode mono" dir="ltr">
              {modeString(d.mode)}
            </span>
          </span>
          <button className="btn ghost mini" onClick={() => void applyOctal()}>
            {t('اعمال')}
          </button>
        </div>
        {row(t('لینک سخت'), fa(d.nlink))}
        {row(t('شناسهٔ فایل'), `${fa(d.inode)} · ${t('دستگاه')} ${fa(d.device)}`, true)}
      </div>
    </>
  )

  const checksums = (d: FileProperties) => (
    <>
      <div className="prop-row">
        <span className="prop-key">{t('چکیدهٔ مورد انتظار')}</span>
        <span className="prop-value">
          <input
            className="prop-input mono"
            dir="ltr"
            placeholder={t('چکیده را اینجا بچسبان')}
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        </span>
        <button className="btn ghost mini" onClick={() => void pasteExpected()}>
          {t('جایگذاری')}
        </button>
      </div>
      {d.dir && <p className="hint">{t('برای پوشه محاسبه نمی‌شود')}</p>}
      <div className="hash-list">
        {ALGOS.map((a) => {
          const hash = hashes[a.id]
          const match = hash && expected.trim() ? normalizeHash(hash) === normalizeHash(expected) : null
          return (
            <div className="hash-row" key={a.id}>
              <span className="hash-name">{a.label}</span>
              <code className="hash-value" dir="ltr">
                {hash ?? '—'}
              </code>
              {match !== null && (
                <span className={'badge ' + (match ? 'ok' : 'bad')}>
                  {match ? t('مطابقت دارد') : t('مطابقت ندارد')}
                </span>
              )}
              <button
                className="btn ghost mini"
                disabled={d.dir || hashing === a.id}
                onClick={() => void compute(a.id)}
              >
                {hashing === a.id ? t('در حال محاسبه…') : t('محاسبه')}
              </button>
              {hash && (
                <button className="btn ghost mini" onClick={() => void copy(hash, a.label)}>
                  {t('کپی')}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </>
  )

  const details = (d: FileProperties) => (
    <>
      {row(t('نوع'), entry ? typeLabel(entry) : d.ext.toUpperCase())}
      {row(t('نوع محتوا'), d.mime || '—', true)}
      {row(t('اندازه'), sizeText(d))}
      {d.dims && row(t('ابعاد'), `${fa(d.dims.w)} × ${fa(d.dims.h)} ${t('پیکسل')}`)}
      {row(t('ساخته‌شده'), fmtDate(d.birthtime, 'iso', true), true)}
      {row(t('تغییر یافته'), fmtDate(d.mtime, 'iso', true), true)}
      {row(t('آخرین دسترسی'), fmtDate(d.atime, 'iso', true), true)}
      {row(t('تغییر متادیتا'), fmtDate(d.ctime, 'iso', true), true)}

      <div className="prop-section">
        <h4>{t('برچسب')}</h4>
        <div className="prop-chips">
          <button className={'chip' + (label === null ? ' on' : '')} onClick={() => void saveLabel(null)}>
            {t('بدون برچسب')}
          </button>
          {palette.map((p) => (
            <button
              key={p.id}
              className={'chip' + (label === p.id ? ' on' : '')}
              onClick={() => void saveLabel(p.id)}
            >
              <span className="lbl" style={{ background: p.color }} />
              {t(p.name)}
            </button>
          ))}
        </div>
      </div>

      <div className="prop-section">
        <h4>{t('امتیاز')}</h4>
        <div className="stars" dir="ltr">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className={'star' + (stars >= n ? ' on' : '')}
              title={t('{n} ستاره', { n: fa(n) })}
              onClick={() => void saveStars(n)}
            >
              ★
            </button>
          ))}
          <span className={'star-value' + (stars ? '' : ' dim')}>
            {stars ? t('{n} از ۵', { n: fa(stars) }) : t('بی‌امتیاز')}
          </span>
        </div>
      </div>

      <div className="prop-section">
        <h4>{t('توضیح')}</h4>
        <textarea
          className="note-input props-note"
          dir="auto"
          rows={4}
          maxLength={500}
          placeholder={t('توضیح کوتاه…')}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
        />
        <div className="prop-actions">
          <button className="btn ghost mini" disabled={savingNote} onClick={() => void saveNote()}>
            {savingNote ? t('در حال ذخیره…') : t('ذخیره')}
          </button>
        </div>
      </div>
    </>
  )

  return (
    <div className="modal" onMouseDown={onClose}>
      <div
        className="dialog props"
        role="dialog"
        aria-modal="true"
        aria-labelledby="props-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="props-head">
          <div className="props-icon">{icon}</div>
          <div className="props-id">
            <div id="props-title" className="props-name" dir="auto" title={data?.path ?? path}>
              {data?.name ?? baseName(path)}
            </div>
            <div className="props-kind">{entry ? typeLabel(entry) : t('در حال خواندن…')}</div>
            {data?.dir && onChangeIcon && (
              <button className="btn ghost props-icon-btn" onClick={onChangeIcon}>
                {t('تغییر آیکون…')}
              </button>
            )}
          </div>
        </div>

        <div className="props-tabs" role="tablist">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              role="tab"
              aria-selected={tab === tb.id}
              className={'props-tab' + (tab === tb.id ? ' on' : '')}
              onClick={() => setTab(tb.id)}
            >
              {t(tb.label)}
            </button>
          ))}
        </div>

        <div className="props-body" role="tabpanel">
          {failed && <p className="hint">{t('ویژگی‌ها خوانده نشد')}</p>}
          {!data && !failed && <p className="hint">{t('در حال خواندن…')}</p>}
          {data && tab === 'general' && general(data)}
          {data && tab === 'permissions' && permissions(data)}
          {data && tab === 'checksums' && checksums(data)}
          {data && tab === 'details' && details(data)}
        </div>

        <div className="props-foot">
          <button className="btn ghost" onClick={() => void api.reveal(path)}>
            {t('نمایش در فایل‌منیجر')}
          </button>
          <button className="btn" onClick={onClose}>
            {t('بستن')}
          </button>
        </div>

        {openWith && (
          <OpenWithDialog
            path={path}
            onClose={() => setOpenWith(false)}
            onNote={(m) => onNote(m)}
          />
        )}
      </div>
    </div>
  )
}
