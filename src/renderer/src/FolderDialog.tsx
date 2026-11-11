import { t } from './i18n.ts'
import { useEffect, useState, type ReactElement } from 'react'
import { api, type Entry, type FolderMeta, type IconRef, type IconTheme } from './api'
import { mediaUrl } from './format'
import { ArchiveIcon, FolderGlyph, FolderIcon, HomeIcon, ImageIcon, SearchIcon, StarIcon } from './Icons'

type Props = {
  /** one or more folders; the same colour/icon is applied to every one of them */
  dirs: string[]
  name: string
  meta: FolderMeta | null
  iconDirs: string[]
  onSave(patch: FolderMeta): void
  onAddIconDir(dir: string): void
  onClose(): void
}

/** The same palette the labels use, so the two colour pickers never disagree. */
const COLORS: { color: string; label: string }[] = [
  { color: '#e0564d', label: t('قرمز') },
  { color: '#e08b39', label: t('نارنجی') },
  { color: '#d8b93f', label: t('زرد') },
  { color: '#4fb56a', label: t('سبز') },
  { color: '#4f8ff0', label: t('آبی') },
  { color: '#9a6ee0', label: t('بنفش') },
  { color: '#dd6b9c', label: t('صورتی') },
  { color: '#8a93a3', label: t('خاکستری') }
]

const BUILTIN: { key: string; label: string; Glyph: (p: { size?: number }) => ReactElement }[] = [
  { key: 'g:folder', label: t('پوشه'), Glyph: FolderIcon },
  { key: 'g:star', label: t('ستاره'), Glyph: () => <StarIcon filled /> },
  { key: 'g:home', label: t('خانه'), Glyph: HomeIcon },
  { key: 'g:archive', label: t('بایگانی'), Glyph: ArchiveIcon },
  { key: 'g:image', label: t('تصویر'), Glyph: ImageIcon }
]

export function FolderDialog({ dirs, name, meta, iconDirs, onSave, onAddIconDir, onClose }: Props) {
  const dir = dirs[0] ?? ''
  const [tab, setTab] = useState<'color' | 'icon'>('color')
  const [themes, setThemes] = useState<IconTheme[]>([])
  const [theme, setTheme] = useState('')
  const [icons, setIcons] = useState<IconRef[]>([])
  const [q, setQ] = useState('')
  const [newDir, setNewDir] = useState('')

  useEffect(() => {
    void api.iconThemes(iconDirs).then((t) => {
      setThemes(t)
      setTheme((cur) => cur || t[0]?.dir || '')
    })
  }, [iconDirs])

  useEffect(() => {
    if (!theme) return
    void api.iconsIn(theme).then(setIcons)
  }, [theme])

  const shown = icons.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase())).slice(0, 120)

  // exactly what the listing will draw for this folder, so the choice is visible before saving
  const preview: Entry = {
    name,
    path: dir,
    dir: true,
    size: 0,
    mtime: 0,
    ext: '',
    color: meta?.color,
    icon: meta?.icon
  }

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="dialog wide folder-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">
          <span>{t('ظاهر پوشه')}</span>
          <span className="dialog-sub" dir="auto" title={dir}>
            {name}
          </span>
        </div>

        <div className="seg">
          <button className={tab === 'color' ? 'on' : ''} onClick={() => setTab('color')}>
            {t('رنگ')}
          </button>
          <button className={tab === 'icon' ? 'on' : ''} onClick={() => setTab('icon')}>
            {t('آیکون')}
          </button>
        </div>

        <div className={'folder-body' + (tab === 'color' ? ' center' : '')}>
          <div className="look-preview">
            <FolderGlyph entry={preview} size={46} />
            <span className="look-name" dir="auto">
              {name}
            </span>
          </div>

          {tab === 'color' ? (
            <>
              <div className="color-dots">
                {COLORS.map((c) => (
                  <button
                    key={c.color}
                    className={'dot' + (meta?.color === c.color ? ' on' : '')}
                    style={{ background: c.color }}
                    title={c.label}
                    aria-label={c.label}
                    onClick={() => onSave({ color: c.color })}
                  />
                ))}
                <button
                  className={'dot none' + (!meta?.color ? ' on' : '')}
                  title={t('بدون رنگ')}
                  onClick={() => onSave({ color: '' })}
                >
                  <span>×</span>
                </button>
              </div>
              <div className="hint">
                {t(
                  'رنگ در فایل مخفی .mfm.json داخل همین پوشه ذخیره می‌شود؛ با پوشه جابه‌جا می‌شود و به قابلیت‌های سیستم‌عامل وابسته نیست.'
                )}
              </div>
            </>
          ) : (
            <>
              <div className="row-gap">
                <label className="field">
                  <span>{t('پک آیکون')}</span>
                  <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                    {themes.map((t) => (
                      <option key={t.dir} value={t.dir}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="filter grow">
                  <SearchIcon />
                  <input
                    dir="auto"
                    placeholder={t('نام آیکون')}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </label>
              </div>

              <div className="iconbar">
                {BUILTIN.map(({ key, label, Glyph }) => (
                  <button
                    key={key}
                    className={'icell' + (meta?.icon === key ? ' on' : '')}
                    title={label}
                    onClick={() => onSave({ icon: key })}
                  >
                    <Glyph size={22} />
                  </button>
                ))}
                {shown.map((i) => (
                  <button
                    key={i.path}
                    className={'icell' + (meta?.icon === i.path ? ' on' : '')}
                    title={i.name}
                    onClick={() => onSave({ icon: i.path })}
                  >
                    <img src={mediaUrl(i.path)} alt="" loading="lazy" />
                  </button>
                ))}
                {!shown.length && <span className="hint">{t('آیکونی با این نام در این پک نیست.')}</span>}
              </div>

              <div className="row-gap">
                <label className="field">
                  <span>{t('افزودن پک دلخواه (مسیر پوشهٔ svg/png)')}</span>
                  <input
                    dir="ltr"
                    value={newDir}
                    placeholder="/path/to/my-icons"
                    onChange={(e) => setNewDir(e.target.value)}
                  />
                </label>
                <button className="btn" onClick={() => newDir && onAddIconDir(newDir)}>
                  {t('افزودن')}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="dialog-actions">
          <label className="check folder-hide" title={t('پوشه‌های پنهان با نمایش فایل‌های مخفی دیده می‌شوند')}>
            <input
              type="checkbox"
              checked={!!meta?.hidden}
              onChange={(e) => onSave({ hidden: e.target.checked })}
            />
            <span>{t('در فهرست والد نمایش داده نشود')}</span>
          </label>
          <button className="btn ghost" onClick={() => onSave({ color: '', icon: '' })}>
            {t('پاک کردن ظاهر')}
          </button>
          <button className="btn" onClick={onClose}>
            {t('بستن')}
          </button>
        </div>
      </div>
    </div>
  )
}
