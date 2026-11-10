import { useEffect, useState, type ReactElement } from 'react'
import { api, type FolderMeta, type IconRef, type IconTheme } from './api'
import { mediaUrl } from './format'
import { ArchiveIcon, FolderIcon, HomeIcon, ImageIcon, SearchIcon, StarIcon } from './Icons'

type Props = {
  dir: string
  name: string
  meta: FolderMeta | null
  iconDirs: string[]
  onSave(patch: FolderMeta): void
  onAddIconDir(dir: string): void
  onClose(): void
}

const COLORS = ['#6aa8ff', '#b18cff', '#ff7a9c', '#4fd1c5', '#e3a44d', '#63c98f', '#f0736b', '#9aa3b2']

const BUILTIN: { key: string; label: string; Glyph: () => ReactElement }[] = [
  { key: 'g:folder', label: 'پوشه', Glyph: FolderIcon },
  { key: 'g:star', label: 'ستاره', Glyph: () => <StarIcon filled /> },
  { key: 'g:home', label: 'خانه', Glyph: HomeIcon },
  { key: 'g:archive', label: 'بایگانی', Glyph: ArchiveIcon },
  { key: 'g:image', label: 'تصویر', Glyph: ImageIcon }
]

export function FolderDialog({ dir, name, meta, iconDirs, onSave, onAddIconDir, onClose }: Props) {
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

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="dialog wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dlg-title" dir="auto">
          ظاهر پوشه · {name}
        </div>

        <div className="seg">
          <button className={tab === 'color' ? 'on' : ''} onClick={() => setTab('color')}>
            رنگ
          </button>
          <button className={tab === 'icon' ? 'on' : ''} onClick={() => setTab('icon')}>
            آیکون
          </button>
        </div>

        {tab === 'color' ? (
          <>
            <div className="swatches">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={'swatch' + (meta?.color === c ? ' on' : '')}
                  style={{ background: c }}
                  title={c}
                  onClick={() => onSave({ color: c })}
                />
              ))}
              <button className="swatch none" title="بدون رنگ" onClick={() => onSave({ color: '' })}>
                ×
              </button>
            </div>
            <div className="hint">
              رنگ در فایل مخفی <code>.mfm.json</code> داخل همین پوشه ذخیره می‌شود؛ با پوشه جابه‌جا می‌شود و به
              قابلیت‌های سیستم‌عامل وابسته نیست.
            </div>
          </>
        ) : (
          <>
            <div className="row-gap">
              <label className="field">
                <span>پک آیکون</span>
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
                <input dir="auto" placeholder="نام آیکون" value={q} onChange={(e) => setQ(e.target.value)} />
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
                  <Glyph />
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
              {!shown.length && <span className="hint">آیکونی با این نام در این پک نیست.</span>}
            </div>

            <div className="row-gap">
              <label className="field">
                <span>افزودن پک دلخواه (مسیر پوشهٔ svg/png)</span>
                <input
                  dir="ltr"
                  value={newDir}
                  placeholder="/path/to/my-icons"
                  onChange={(e) => setNewDir(e.target.value)}
                />
              </label>
              <button className="btn" onClick={() => newDir && onAddIconDir(newDir)}>
                افزودن
              </button>
            </div>
          </>
        )}

        <div className="dlg-actions">
          <button onClick={() => onSave({ color: '', icon: '' })}>پاک کردن ظاهر</button>
          <button onClick={onClose}>بستن</button>
        </div>
      </div>
    </div>
  )
}
