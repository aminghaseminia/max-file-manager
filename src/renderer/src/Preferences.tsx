import { useEffect, useState } from 'react'
import { COLUMNS, DEFAULT_TOOLBAR, type ColId, type Prefs } from './prefs'
import { XIcon } from './Icons'
import { COMMANDS, COMMAND_BY_ID, DEFAULT_SHORTCUTS, GROUP_LABEL, type CommandGroup } from './commands'
import { accelFromEvent, findConflicts, formatAccel } from './keys'

type Page =
  | 'appearance'
  | 'display'
  | 'columns'
  | 'toolbar'
  | 'keys'
  | 'layout'
  | 'archive'
  | 'transfer'
  | 'operations'
  | 'launch'
  | 'advanced'

const PAGES: { id: Page; label: string }[] = [
  { id: 'appearance', label: 'ظاهر و رنگ' },
  { id: 'display', label: 'نمایش فایل‌ها' },
  { id: 'columns', label: 'ستون‌ها' },
  { id: 'toolbar', label: 'نوار ابزار' },
  { id: 'keys', label: 'کلید میان‌بر' },
  { id: 'layout', label: 'پنجره و چیدمان' },
  { id: 'archive', label: 'بایگانی و گالری' },
  { id: 'transfer', label: 'انتقال' },
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
  const [capturing, setCapturing] = useState<string | null>(null)

  // while capturing, the next keydown becomes the accelerator for that command
  useEffect(() => {
    if (!capturing) return
    const onKey = (ev: KeyboardEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      if (ev.key === 'Escape') {
        setCapturing(null)
        return
      }
      const accel = accelFromEvent(ev)
      if (!accel) return
      onChange({ shortcuts: { ...prefs.shortcuts, [capturing]: accel } })
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, prefs.shortcuts])

  const conflicts = findConflicts(prefs.shortcuts)

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
              {row(
                'قالب اندازه',
                null,
                seg(
                  prefs.sizeFormat,
                  [{ v: 'human', label: 'خوانا' }, { v: 'bytes', label: 'بایت دقیق' }],
                  'sizeFormat'
                )
              )}
              {row(
                'قالب تاریخ',
                null,
                seg(
                  prefs.dateFormat,
                  [
                    { v: 'jalali', label: 'شمسی' },
                    { v: 'iso', label: 'میلادی' },
                    { v: 'short', label: 'فقط ساعت' }
                  ],
                  'dateFormat'
                )
              )}
              {row('ثانیه در تاریخ', null, check(prefs.showSeconds, 'showSeconds'))}
            </>
          )}

          {page === 'columns' && (
            <>
              {COLUMNS.map((c, idx) => {
                const on = prefs.columns.includes(c.id)
                const move = (delta: number) => {
                  const next = [...prefs.columns]
                  const at = next.indexOf(c.id)
                  const to = at + delta
                  if (at < 0 || to < 0 || to >= next.length) return
                  ;[next[at], next[to]] = [next[to], next[at]]
                  onChange({ columns: next })
                }
                return (
                  <div className="pref-row" key={c.id}>
                    <div className="pref-label">
                      <span>{c.label}</span>
                    </div>
                    <div className="pref-control">
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) =>
                            onChange({
                              columns: e.target.checked
                                ? [...prefs.columns, c.id]
                                : prefs.columns.filter((x) => x !== c.id)
                            })
                          }
                        />
                      </label>
                      <button
                        className="tb"
                        title="بالا"
                        disabled={!on || idx === 0}
                        onClick={() => move(-1)}
                      >
                        ▲
                      </button>
                      <button
                        className="tb"
                        title="پایین"
                        disabled={!on || idx === 0}
                        onClick={() => move(1)}
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                )
              })}
              <div className="hint">
                ستون «نام» همیشه اول است. ترتیب انتخاب‌شده در فهرست اعمال می‌شود.
              </div>
            </>
          )}

          {page === 'toolbar' && (
            <>
              <div className="hint">
                دکمه‌های نوار فرمان را انتخاب و مرتب کن. نوار خالی یعنی نوار پنهان.
              </div>
              {COMMANDS.map((c) => {
                const on = prefs.toolbar.includes(c.id)
                const move = (delta: number) => {
                  const next = [...prefs.toolbar]
                  const at = next.indexOf(c.id)
                  const to = at + delta
                  if (at < 0 || to < 0 || to >= next.length) return
                  ;[next[at], next[to]] = [next[to], next[at]]
                  onChange({ toolbar: next })
                }
                return (
                  <div className="pref-row" key={c.id}>
                    <div className="pref-label">
                      <span>{c.label}</span>
                      <span className="hint">{GROUP_LABEL[c.group]}</span>
                    </div>
                    <div className="pref-control">
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) =>
                            onChange({
                              toolbar: e.target.checked
                                ? [...prefs.toolbar, c.id]
                                : prefs.toolbar.filter((x) => x !== c.id)
                            })
                          }
                        />
                      </label>
                      <button className="tb" title="بالا" disabled={!on} onClick={() => move(-1)}>
                        ▲
                      </button>
                      <button className="tb" title="پایین" disabled={!on} onClick={() => move(1)}>
                        ▼
                      </button>
                    </div>
                  </div>
                )
              })}
              <div className="pref-row">
                <div className="pref-label">
                  <span>بازنشانی نوار ابزار</span>
                </div>
                <div className="pref-control">
                  <button className="btn ghost" onClick={() => onChange({ toolbar: DEFAULT_TOOLBAR })}>
                    پیش‌فرض
                  </button>
                </div>
              </div>
            </>
          )}

          {page === 'keys' && (
            <>
              {conflicts.length > 0 && (
                <div className="warn">
                  تعارض: {conflicts.map((id) => COMMAND_BY_ID[id]?.label ?? id).join(' ، ')} — یک کلید
                  به چند فرمان داده شده؛ اولی در فهرست اجرا می‌شود.
                </div>
              )}
              {(Object.keys(GROUP_LABEL) as CommandGroup[]).map((g) => (
                <div key={g}>
                  <div className="pref-group">{GROUP_LABEL[g]}</div>
                  {COMMANDS.filter((c) => c.group === g).map((c) => {
                    const accel = prefs.shortcuts[c.id] ?? ''
                    const bad = conflicts.includes(c.id)
                    return (
                      <div className="pref-row" key={c.id}>
                        <div className="pref-label">
                          <span className={bad ? 'bad' : ''}>{c.label}</span>
                        </div>
                        <div className="pref-control">
                          <button
                            className={'keycap' + (capturing === c.id ? ' live' : '') + (bad ? ' bad' : '')}
                            onClick={() => setCapturing(capturing === c.id ? null : c.id)}
                          >
                            {capturing === c.id ? 'کلید را بزن…' : accel ? formatAccel(accel) : 'بدون کلید'}
                          </button>
                          <button
                            className="tb"
                            title="حذف کلید"
                            onClick={() =>
                              onChange({ shortcuts: { ...prefs.shortcuts, [c.id]: '' } })
                            }
                          >
                            <XIcon size={11} />
                          </button>
                          <button
                            className="tb"
                            title="پیش‌فرض"
                            onClick={() =>
                              onChange({
                                shortcuts: { ...prefs.shortcuts, [c.id]: DEFAULT_SHORTCUTS[c.id] }
                              })
                            }
                          >
                            ↺
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
              <div className="pref-row">
                <div className="pref-label">
                  <span>بازنشانی همهٔ کلیدها</span>
                </div>
                <div className="pref-control">
                  <button className="btn ghost" onClick={() => onChange({ shortcuts: DEFAULT_SHORTCUTS })}>
                    همه پیش‌فرض
                  </button>
                </div>
              </div>
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

          {page === 'archive' && (
            <>
              {row(
                'سطح فشرده‌سازی zip',
                '۰ = بدون فشرده‌سازی (سریع‌ترین)، ۹ = بیشترین فشرده‌سازی',
                <div className="inline-field">
                  <input
                    type="number"
                    min={0}
                    max={9}
                    value={prefs.zipLevel}
                    onChange={(e) =>
                      onChange({ zipLevel: Math.min(9, Math.max(0, Number(e.target.value) || 0)) })
                    }
                  />
                </div>
              )}
              {row(
                'قالب ذخیرهٔ تصویر',
                'فقط روی «ذخیره به‌عنوان کپی» اثر دارد؛ جایگزینی همیشه قالب خود فایل را نگه می‌دارد',
                seg(
                  prefs.imageFormat,
                  [
                    { v: 'png', label: 'PNG' },
                    { v: 'jpeg', label: 'JPEG' },
                    { v: 'webp', label: 'WebP' }
                  ],
                  'imageFormat'
                )
              )}
              {row(
                'کیفیت تصویر',
                '۵۰ تا ۱۰۰؛ برای PNG بی‌اثر است',
                <div className="inline-field">
                  <input
                    type="number"
                    min={50}
                    max={100}
                    step={5}
                    value={prefs.imageQuality}
                    onChange={(e) =>
                      onChange({ imageQuality: Math.min(100, Math.max(50, Number(e.target.value) || 90)) })
                    }
                  />
                  <span>%</span>
                </div>
              )}
              {row(
                'فاصلهٔ پخش خودکار گالری',
                'ثانیه بین دو عکس در حالت اسلاید',
                <div className="inline-field">
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={prefs.slideshowSec}
                    onChange={(e) =>
                      onChange({ slideshowSec: Math.min(60, Math.max(1, Number(e.target.value) || 3)) })
                    }
                  />
                  <span>ثانیه</span>
                </div>
              )}
              {row('حلقه‌ای بودن گالری', 'در آخرین عکس به اولی برگردد', check(prefs.galleryLoop, 'galleryLoop'))}
              {row(
                'سقف پیش‌نمایش متن',
                'کیلوبایت؛ فایل بزرگ‌تر بریده می‌شود',
                <div className="inline-field">
                  <input
                    type="number"
                    min={16}
                    max={8192}
                    step={16}
                    value={prefs.previewMaxKB}
                    onChange={(e) =>
                      onChange({ previewMaxKB: Math.min(8192, Math.max(16, Number(e.target.value) || 200)) })
                    }
                  />
                  <span>KB</span>
                </div>
              )}
            </>
          )}

          {page === 'transfer' && (
            <>
              {row(
                'رد کردن فایل‌های موجود',
                'اگر نامی در مقصد هست، همان‌جا بمانَد و کپی نشود (به‌جای ساختن «نام (۲)»)',
                check(prefs.transferSkipExisting, 'transferSkipExisting')
              )}
              {row(
                'فقط جدیدترها',
                'اگر فایل مقصد جدیدتر یا هم‌زمان باشد، منتقل نشود',
                check(prefs.transferNewerOnly, 'transferNewerOnly')
              )}
              {row(
                'محدودیت سرعت',
                'کیلوبایت بر ثانیه؛ ۰ یعنی بی‌نهایت',
                <div className="inline-field">
                  <input
                    type="number"
                    min={0}
                    step={256}
                    value={prefs.speedLimitKB}
                    onChange={(e) =>
                      onChange({ speedLimitKB: Math.max(0, Number(e.target.value) || 0) })
                    }
                  />
                  <span>KB/s</span>
                </div>
              )}
              <div className="hint">
                فیلترها روی هر سه مسیر کپی/انتقال (دکمه‌ها، کلیدها و کشیدن‌و‌رهاکردن) اعمال می‌شوند و
                تعداد فایل‌های رد‌شده در نوار عملیات‌ها نوشته می‌شود.
              </div>
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
                'کلید سراسری باز کردن',
                'روی X11 کار می‌کند؛ روی Wayland باید همان کلید را در تنظیمات KDE به «Add Command» بدهی (راهنما در docs/INTEGRATION.md)',
                check(prefs.hotkeyEnabled, 'hotkeyEnabled')
              )}
              {row(
                'ترکیب کلید',
                'مثال: Super+E یا Ctrl+Alt+M',
                <input
                  className="pref-input"
                  dir="ltr"
                  value={prefs.hotkey}
                  onChange={(e) => onChange({ hotkey: e.target.value })}
                />
              )}
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
