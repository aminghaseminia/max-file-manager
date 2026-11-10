import { useState } from 'react'
import type { Prefs } from './prefs'

type Page = 'appearance' | 'display' | 'layout' | 'operations' | 'launch' | 'advanced'

const PAGES: { id: Page; label: string }[] = [
  { id: 'appearance', label: 'ظاهر و رنگ' },
  { id: 'display', label: 'نمایش فایل‌ها' },
  { id: 'layout', label: 'پنجره و چیدمان' },
  { id: 'operations', label: 'عملیات فایل' },
  { id: 'launch', label: 'راه‌اندازی' },
  { id: 'advanced', label: 'پیشرفته' }
]

type Props = {
  prefs: Prefs
  onChange(patch: Partial<Prefs>): void
  onClose(): void
}

export function Preferences({ prefs, onChange, onClose }: Props) {
  const [page, setPage] = useState<Page>('appearance')

  const row = (label: string, hint: string | null, control: React.ReactNode) => (
    <div className="pref-row">
      <div className="pref-label">
        <span>{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </div>
      <div className="pref-control">{control}</div>
    </div>
  )

  const seg = <T extends string>(value: T, options: { v: T; label: string }[], key: keyof Prefs) => (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.v}
          className={value === o.v ? 'on' : ''}
          onClick={() => onChange({ [key]: o.v } as Partial<Prefs>)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )

  const check = (checked: boolean, key: keyof Prefs) => (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange({ [key]: e.target.checked } as Partial<Prefs>)}
      />
    </label>
  )

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="prefs" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="prefs-nav">
          <div className="prefs-title">تنظیمات</div>
          {PAGES.map((p) => (
            <button
              key={p.id}
              className={'prefs-tab' + (page === p.id ? ' on' : '')}
              onClick={() => setPage(p.id)}
            >
              {p.label}
            </button>
          ))}
          <span className="spacer" />
          <button className="prefs-tab" onClick={onClose}>
            بستن
          </button>
        </nav>

        <section className="prefs-body">
          {page === 'appearance' && (
            <>
              {row('تم', null, seg(prefs.theme, [{ v: 'dark', label: 'تیره' }, { v: 'light', label: 'روشن' }], 'theme'))}
              {row(
                'تایتل‌بار',
                'سیستم = قاب سیستم‌عامل، برنامه = نوار خود اپ',
                seg(prefs.titlebar, [{ v: 'system', label: 'سیستم' }, { v: 'app', label: 'برنامه' }], 'titlebar')
              )}
              {row(
                'گوشه‌های گرد پنجره',
                prefs.titlebar === 'system' ? 'فقط با تایتل‌بار برنامه ممکن است' : null,
                <label className="check">
                  <input
                    type="checkbox"
                    checked={prefs.rounded}
                    disabled={prefs.titlebar === 'system'}
                    onChange={(e) => onChange({ rounded: e.target.checked })}
                  />
                </label>
              )}
            </>
          )}

          {page === 'display' && (
            <>
              {row('نمای پیش‌فرض', null, seg(prefs.view, [{ v: 'list', label: 'فهرست' }, { v: 'grid', label: 'شبکه' }], 'view'))}
              {row('پوشه‌ها اول فهرست', 'مانند Directory Opus و FreeCommander', check(prefs.foldersFirst, 'foldersFirst'))}
              {row('نمایش فایل‌های مخفی', 'پیش‌فرضِ آغاز به کار', check(prefs.showHidden, 'showHidden'))}
              {row('ستون «نوع»', null, check(prefs.showTypeColumn, 'showTypeColumn'))}
            </>
          )}

          {page === 'layout' && (
            <>
              {row(
                'چیدمان پنجره',
                'تک‌پنجره = مثل Explorer، دوپنجره = مثل Total Commander',
                seg(prefs.layout, [{ v: 'single', label: 'تک‌پنجره' }, { v: 'dual', label: 'دوپنجره' }], 'layout')
              )}
              {row(
                'سایدبار',
                null,
                seg(prefs.sidebar, [{ v: 'docked', label: 'چسبیده' }, { v: 'float', label: 'شناور' }], 'sidebar')
              )}
              {row('نمایش سایدبار', null, check(prefs.sidebarOpen, 'sidebarOpen'))}
            </>
          )}

          {page === 'operations' && (
            <>
              {row(
                'دوبار کلیک روی فایل',
                null,
                seg(
                  prefs.doubleClick,
                  [
                    { v: 'open', label: 'اجرا' },
                    { v: 'gallery', label: 'گالری' },
                    { v: 'preview', label: 'پیش‌نمایش' }
                  ],
                  'doubleClick'
                )
              )}
              {row('تأیید پیش از حذف', 'پرسش قبل از سطل بازیافت یا حذف قطعی', check(prefs.confirmDelete, 'confirmDelete'))}
              {row('حذف پیش‌فرض به سطل بازیافت', 'خاموش = حذف قطعی', check(prefs.trashByDefault, 'trashByDefault'))}
            </>
          )}

          {page === 'launch' && (
            <>
              {row(
                'تک‌نمونه (single instance)',
                'اجرای دوباره، پنجرهٔ موجود را جلو می‌آورد · با راه‌اندازی بعدی اعمال می‌شود',
                check(prefs.singleInstance, 'singleInstance')
              )}
              {row(
                'پوشهٔ شروع',
                'خالی = همان نشست قبلی',
                <input
                  className="pref-input"
                  dir="ltr"
                  value={prefs.startFolder}
                  placeholder="/home/…"
                  onChange={(e) => onChange({ startFolder: e.target.value })}
                />
              )}
            </>
          )}

          {page === 'advanced' && (
            <>
              <div className="hint">
                پک‌های آیکون افزوده‌شده: {prefs.iconDirs.length ? prefs.iconDirs.join(' · ') : 'هیچ'}
              </div>
              <div className="hint">
                تنظیمات در <code>state.json</code> کنار پروفایل برنامه ذخیره می‌شود؛ رنگ و آیکون هر پوشه در
                فایل <code>.mfm.json</code> داخل خود پوشه.
              </div>
              <div className="hint">
                دسته‌های بعدی طبق نقشهٔ راه (docs/PREFERENCES.md): ستون‌های سفارشی، نوار ابزار و کلیدها،
                فیلتر و مرتب‌سازی، تب‌ها، درخت پوشه، بایگانی، شبکه.
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
