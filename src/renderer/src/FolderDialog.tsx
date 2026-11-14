import { t } from './i18n.ts'
import { useEffect, useState, type ReactElement } from 'react'
import { api, type Entry, type FolderMeta, type IconTheme } from './api'
import { fa, mediaUrl } from './format'
import { ArchiveIcon, FolderGlyph, FolderIcon, HomeIcon, ImageIcon, SearchIcon, StarIcon } from './Icons'
import { PURE_PACK, PURE_CATEGORIES } from './pure-set'

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

/** The bundled pack is a synthetic theme: it needs no `iconsIn` walk and works on every OS. */
const EMBEDDED = '@pure'

const CAT_LABEL: Record<string, string> = {
  places: 'دستهٔ مکان‌ها',
  mimetypes: 'دستهٔ انواع فایل',
  apps: 'دستهٔ برنامه‌ها',
  devices: 'دستهٔ دستگاه‌ها',
  status: 'دستهٔ وضعیت',
  applets: 'دستهٔ ویجت‌ها',
  actions: 'دستهٔ اکشن‌ها',
  emblems: 'دستهٔ نشان‌ها'
}
const CAT_RE = /\/(places|mimetypes|apps|devices|status|applets|actions|emblems|categories)\//
const categoryOf = (p: string): string => CAT_RE.exec(p)?.[1] ?? 'other'

type PickIcon = { name: string; path: string; category: string; url?: string }
const GLYPH_SIZE = { s: 20, m: 30, l: 44 } as const

const BUILTIN: { key: string; label: string; Glyph: (p: { size?: number }) => ReactElement }[] = [
  { key: 'g:folder', label: 'پوشه', Glyph: FolderIcon },
  { key: 'g:star', label: 'ستاره', Glyph: () => <StarIcon filled /> },
  { key: 'g:home', label: 'خانه', Glyph: HomeIcon },
  { key: 'g:archive', label: 'بایگانی', Glyph: ArchiveIcon },
  { key: 'g:image', label: 'تصویر', Glyph: ImageIcon }
]

export function FolderDialog({ dirs, name, meta, iconDirs, onSave, onAddIconDir, onClose }: Props) {
  const dir = dirs[0] ?? ''
  const [themes, setThemes] = useState<IconTheme[]>([{ name: 'Pure', dir: EMBEDDED }])
  const [theme, setTheme] = useState(EMBEDDED)
  const [icons, setIcons] = useState<PickIcon[]>([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [size, setSize] = useState<'s' | 'm' | 'l'>('m')
  const [newDir, setNewDir] = useState('')

  useEffect(() => {
    void api.iconThemes(iconDirs).then((list) => {
      setThemes([{ name: 'Pure', dir: EMBEDDED }, ...list.filter((x) => x.dir !== EMBEDDED)])
      setTheme((cur) => cur || EMBEDDED)
    })
  }, [iconDirs])

  useEffect(() => {
    setCat('')
    if (theme === EMBEDDED) {
      setIcons(PURE_PACK.map((i) => ({ name: i.name, path: 'p:' + i.name, category: i.category, url: i.url })))
      return
    }
    if (!theme) return
    void api
      .iconsIn(theme)
      .then((list) => setIcons(list.map((i) => ({ ...i, category: categoryOf(i.path) }))))
  }, [theme])

  const categories = theme === EMBEDDED ? PURE_CATEGORIES : [...new Set(icons.map((i) => i.category))].sort()
  const shown = icons.filter(
    (i) =>
      (!cat || i.category === cat) &&
      (!q || i.name.toLowerCase().includes(q.toLowerCase()))
  )

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
          <span>{t('آیکون پوشه')}</span>
          <span className="dialog-sub" dir="auto" title={dir}>
            {name}
          </span>
        </div>

        <div className="folder-body">
          <div className="look-preview">
            <FolderGlyph entry={preview} size={46} />
            <span className="look-name" dir="auto">
              {name}
            </span>
          </div>

          <div className="icon-toolbar">
            <label className="field">
              <span>{t('پک آیکون')}</span>
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                {themes.map((th) => (
                  <option key={th.dir} value={th.dir}>
                    {th.dir === EMBEDDED ? t('Pure همراه برنامه') : th.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('دسته')}</span>
              <select value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">{t('همهٔ دسته‌ها')}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {t(CAT_LABEL[c] ?? c)}
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

          <div className="icon-tools">
            <div className="field">
              <span>{t('اندازهٔ آیکون')}</span>
              <div className="seg">
                {([['s', 'آیکون کوچک'], ['m', 'آیکون متوسط'], ['l', 'آیکون بزرگ']] as const).map(
                  ([v, label]) => (
                    <button key={v} className={size === v ? 'on' : ''} onClick={() => setSize(v)}>
                      {t(label)}
                    </button>
                  )
                )}
              </div>
            </div>
            <span className="icon-count">{t('{n} آیکون', { n: fa(shown.length) })}</span>
          </div>

          <div className={'iconbar size-' + size}>
            {BUILTIN.map(({ key, label, Glyph }) => (
              <button
                key={key}
                className={'icell' + (meta?.icon === key ? ' on' : '')}
                title={t(label)}
                onClick={() => onSave({ icon: key })}
              >
                <Glyph size={GLYPH_SIZE[size]} />
              </button>
            ))}
            {shown.map((i) => (
              <button
                key={i.path}
                className={'icell' + (meta?.icon === i.path ? ' on' : '')}
                title={i.name}
                onClick={() => onSave({ icon: i.path })}
              >
                <img src={i.url ?? mediaUrl(i.path)} alt="" loading="lazy" />
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
          <button className="btn ghost" onClick={() => onSave({ icon: '' })}>
            {t('پاک کردن آیکون')}
          </button>
          <button className="btn" onClick={onClose}>
            {t('بستن')}
          </button>
        </div>
      </div>
    </div>
  )
}
