import { t } from './i18n.ts'
import { useEffect, useState } from 'react'
import { COLUMNS, DEFAULT_TOOLBAR, type ColId, type Prefs } from './prefs'
import { XIcon } from './Icons'
import { AgentsPage } from './AgentsPage'
import { COMMANDS, COMMAND_BY_ID, DEFAULT_SHORTCUTS, GROUP_ORDER, groupLabelOf, labelOf, type CommandGroup } from './commands'
import { accelFromEvent, findConflicts, formatAccel } from './keys'

type Page =
  | 'appearance'
  | 'display'
  | 'columns'
  | 'toolbar'
  | 'keys'
  | 'layout'
  | 'agents'
  | 'search'
  | 'filetypes'
  | 'archive'
  | 'transfer'
  | 'operations'
  | 'launch'
  | 'advanced'

const PAGES: { id: Page; label: string }[] = [
  { id: 'appearance', label: t('ظاهر و رنگ') },
  { id: 'display', label: t('نمایش فایل‌ها') },
  { id: 'columns', label: t('ستون‌ها') },
  { id: 'toolbar', label: t('نوار ابزار') },
  { id: 'keys', label: t('کلید میان‌بر') },
  { id: 'layout', label: t('پنجره و چیدمان') },
  { id: 'agents', label: t('ایجنت‌ها (MCP)') },
  { id: 'search', label: t('جست‌وجو') },
  { id: 'filetypes', label: t('انواع فایل') },
  { id: 'archive', label: t('بایگانی و گالری') },
  { id: 'transfer', label: t('انتقال') },
  { id: 'operations', label: t('عملیات فایل') },
  { id: 'launch', label: t('راه‌اندازی') },
  { id: 'advanced', label: t('پیشرفته') }
]

type Props = {
  prefs: Prefs
  palette: { id: string; name: string; color: string }[]
  onChange(patch: Partial<Prefs>): void
  onClose(): void
}

export function Preferences({ prefs, palette, onChange, onClose }: Props) {
  const [extInput, setExtInput] = useState('')
  const [newRoot, setNewRoot] = useState('')
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
          <div className="prefs-title">{t(t('تنظیمات'))}</div>
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
          <button className="prefs-tab" onClick={onClose}>{t('بستن')}</button>
        </nav>

        <section className="prefs-body">
          {page === 'appearance' && (
            <>
              {row(t('تم'), null, seg(prefs.theme, [{ v: 'dark', label: t('تیره') }, { v: 'light', label: t('روشن') }], 'theme'))}
              {row(
                t('تایتل‌بار'),
                t('سیستم = قاب سیستم‌عامل، برنامه = نوار خود اپ'),
                seg(prefs.titlebar, [{ v: 'system', label: t('سیستم') }, { v: 'app', label: t('برنامه') }], 'titlebar')
              )}
              {row(
                t('گوشه‌های گرد پنجره'),
                prefs.titlebar === 'system' ? t('فقط با تایتل‌بار برنامه ممکن است') : null,
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
              {row(t('نمای پیش‌فرض'), null, seg(prefs.view, [{ v: 'list', label: t('فهرست') }, { v: 'grid', label: t('شبکه') }], 'view'))}
              {row(t('پوشه‌ها اول فهرست'), t('مانند Directory Opus و FreeCommander'), check(prefs.foldersFirst, 'foldersFirst'))}
              {row(t('نمایش فایل‌های مخفی'), t('پیش‌فرضِ آغاز به کار'), check(prefs.showHidden, 'showHidden'))}
              {row(
                t('قالب اندازه'),
                null,
                seg(
                  prefs.sizeFormat,
                  [{ v: 'human', label: t('خوانا') }, { v: 'bytes', label: t('بایت دقیق') }],
                  'sizeFormat'
                )
              )}
              {row(
                t('قالب تاریخ'),
                null,
                seg(
                  prefs.dateFormat,
                  [
                    { v: 'jalali', label: t('شمسی') },
                    { v: 'iso', label: t('میلادی') },
                    { v: 'short', label: t('فقط ساعت') }
                  ],
                  'dateFormat'
                )
              )}
              {row(t('ثانیه در تاریخ'), null, check(prefs.showSeconds, 'showSeconds'))}
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
                      <span>{labelOf(c)}</span>
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
                        title={t(t('بالا'))}
                        disabled={!on || idx === 0}
                        onClick={() => move(-1)}
                      >
                        ▲
                      </button>
                      <button
                        className="tb"
                        title={t(t('پایین'))}
                        disabled={!on || idx === 0}
                        onClick={() => move(1)}
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                )
              })}
              <div className="hint">{t('ستون «نام» همیشه اول است. ترتیب انتخاب‌شده در فهرست اعمال می‌شود.')}</div>
            </>
          )}

          {page === 'toolbar' && (
            <>
              <div className="hint">{t('دکمه‌های نوار فرمان را انتخاب و مرتب کن. نوار خالی یعنی نوار پنهان.')}</div>
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
                      <span>{labelOf(c)}</span>
                      <span className="hint">{groupLabelOf(c.group)}</span>
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
                      <button className="tb" title={t(t('بالا'))} disabled={!on} onClick={() => move(-1)}>
                        ▲
                      </button>
                      <button className="tb" title={t(t('پایین'))} disabled={!on} onClick={() => move(1)}>
                        ▼
                      </button>
                    </div>
                  </div>
                )
              })}
              <div className="pref-row">
                <div className="pref-label">
                  <span>{t(t('بازنشانی نوار ابزار'))}</span>
                </div>
                <div className="pref-control">
                  <button className="btn ghost" onClick={() => onChange({ toolbar: DEFAULT_TOOLBAR })}>{t('پیش‌فرض')}</button>
                </div>
              </div>
            </>
          )}

          {page === 'keys' && (
            <>
              {conflicts.length > 0 && (
                <div className="warn">
                  تعارض: {conflicts.map((id) => labelOf(COMMAND_BY_ID[id]) || id).join(t(' ، '))} — یک کلید
                  به چند فرمان داده شده؛ اولی در فهرست اجرا می‌شود.|is bound to several commands; the first one in the list wins.
                </div>
              )}
              {(Object.keys(GROUP_ORDER) as CommandGroup[]).map((g) => (
                <div key={g}>
                  <div className="pref-group">{groupLabelOf(g)}</div>
                  {COMMANDS.filter((c) => c.group === g).map((c) => {
                    const accel = prefs.shortcuts[c.id] ?? ''
                    const bad = conflicts.includes(c.id)
                    return (
                      <div className="pref-row" key={c.id}>
                        <div className="pref-label">
                          <span className={bad ? 'bad' : ''}>{labelOf(c)}</span>
                        </div>
                        <div className="pref-control">
                          <button
                            className={'keycap' + (capturing === c.id ? ' live' : '') + (bad ? ' bad' : '')}
                            onClick={() => setCapturing(capturing === c.id ? null : c.id)}
                          >
                            {capturing === c.id ? t('کلید را بزن…') : accel ? formatAccel(accel) : t('بدون کلید')}
                          </button>
                          <button
                            className="tb"
                            title={t(t('حذف کلید'))}
                            onClick={() =>
                              onChange({ shortcuts: { ...prefs.shortcuts, [c.id]: '' } })
                            }
                          >
                            <XIcon size={11} />
                          </button>
                          <button
                            className="tb"
                            title={t(t('پیش‌فرض'))}
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
                  <span>{t(t('بازنشانی همهٔ کلیدها'))}</span>
                </div>
                <div className="pref-control">
                  <button className="btn ghost" onClick={() => onChange({ shortcuts: DEFAULT_SHORTCUTS })}>{t('همه پیش‌فرض')}</button>
                </div>
              </div>
            </>
          )}

          {page === 'layout' && (
            <>
              {row(
                t('چیدمان پنجره'),
                t('تک‌پنجره = مثل Explorer، دوپنجره = مثل Total Commander'),
                seg(prefs.layout, [{ v: 'single', label: t('تک‌پنجره') }, { v: 'dual', label: t('دوپنجره') }], 'layout')
              )}
              {row(
                t('سایدبار'),
                null,
                seg(prefs.sidebar, [{ v: 'docked', label: t('چسبیده') }, { v: 'float', label: t('شناور') }], 'sidebar')
              )}
              {row(t('نمایش سایدبار'), null, check(prefs.sidebarOpen, 'sidebarOpen'))}
            </>
          )}

          {page === 'agents' && (
            <AgentsPage />
          )}

          {page === 'search' && (
            <>
              <div className="hint">
                {t('ایندکس روی این پوشه‌ها ساخته می‌شود (خالی = پوشه‌های پیش‌فرض سیستم: Documents, Downloads, Desktop, Pictures, Music, Videos). جست‌وجو با Ctrl+Shift+K.')}
              </div>
              <div className="preset-list">
                {prefs.searchRoots.length === 0 && (
                  <div className="dim">{t(t('پوشهٔ پیش‌فرض سیستم استفاده می‌شود'))}</div>
                )}
                {prefs.searchRoots.map((r) => (
                  <div className="preset-row" key={r}>
                    <span className="preset-name" dir="auto">
                      {r}
                    </span>
                    <button
                      className="tb"
                      title={t(t('حذف از ایندکس'))}
                      onClick={() =>
                        onChange({ searchRoots: prefs.searchRoots.filter((x) => x !== r) })
                      }
                    >
                      <XIcon size={11} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="preset-save">
                <input
                  className="pref-input wide"
                  dir="ltr"
                  placeholder="/path/to/folder"
                  value={newRoot}
                  onChange={(e) => setNewRoot(e.target.value)}
                />
                <button
                  className="btn"
                  disabled={!newRoot.startsWith('/')}
                  onClick={() => {
                    onChange({ searchRoots: [...prefs.searchRoots, newRoot.trim()] })
                    setNewRoot('')
                  }}
                >{t('افزودن پوشه')}</button>
              </div>
              {row(
                t('استثناها'),
                t('با کاما جدا کن؛ * هم مجاز است (مثلاً node_modules, *.tmp)'),
                <input
                  className="pref-input wide"
                  dir="ltr"
                  value={prefs.searchExclude.join(', ')}
                  onChange={(e) =>
                    onChange({
                      searchExclude: e.target.value
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean)
                    })
                  }
                />
              )}
            </>
          )}

          {page === 'filetypes' && (
            <>
              <div className="hint">{t('برای هر پسوند یک رنگ بگذار؛ نقطهٔ رنگی کنار نام فایل در فهرست دیده می‌شود.')}</div>
              <div className="preset-save">
                <input
                  className="pref-input"
                  dir="ltr"
                  placeholder={t(t('پسوند، مثلاً pdf'))}
                  value={extInput}
                  onChange={(e) => setExtInput(e.target.value.replace(/^\./, '').toLowerCase())}
                />
                {palette.map((c) => (
                  <button
                    key={c.id}
                    className="swatch"
                    title={t(c.name)}
                    style={{ background: c.color }}
                    disabled={!extInput.trim()}
                    onClick={() =>
                      onChange({
                        fileTypes: { ...prefs.fileTypes, [extInput.trim()]: c.color }
                      })
                    }
                  />
                ))}
              </div>
              <div className="preset-list">
                {Object.keys(prefs.fileTypes).length === 0 && (
                  <div className="dim">{t(t('هنوز پسوندی رنگ نگرفته'))}</div>
                )}
                {Object.entries(prefs.fileTypes).map(([ext, color]) => (
                  <div className="preset-row" key={ext}>
                    <span className="ftdot" style={{ background: color }} />
                    <span className="preset-name" dir="ltr">
                      .{ext}
                    </span>
                    <button
                      className="tb"
                      title={t(t('حذف'))}
                      onClick={() => {
                        const next = { ...prefs.fileTypes }
                        delete next[ext]
                        onChange({ fileTypes: next })
                      }}
                    >
                      <XIcon size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {page === 'archive' && (
            <>
              {row(
                t('سطح فشرده‌سازی zip'),
                t('۰ = بدون فشرده‌سازی (سریع‌ترین)، ۹ = بیشترین فشرده‌سازی'),
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
                t('قالب ذخیرهٔ تصویر'),
                t('فقط روی «ذخیره به‌عنوان کپی» اثر دارد؛ جایگزینی همیشه قالب خود فایل را نگه می‌دارد'),
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
                t('کیفیت تصویر'),
                t('۵۰ تا ۱۰۰؛ برای PNG بی‌اثر است'),
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
                t('فاصلهٔ پخش خودکار گالری'),
                t('ثانیه بین دو عکس در حالت اسلاید'),
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
                  <span>{t(t('ثانیه'))}</span>
                </div>
              )}
              {row(t('حلقه‌ای بودن گالری'), t('در آخرین عکس به اولی برگردد'), check(prefs.galleryLoop, 'galleryLoop'))}
              {row(
                t('سقف پیش‌نمایش متن'),
                t('کیلوبایت؛ فایل بزرگ‌تر بریده می‌شود'),
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
                t('رد کردن فایل‌های موجود'),
                t('اگر نامی در مقصد هست، همان‌جا بمانَد و کپی نشود (به‌جای ساختن «نام (۲)»)'),
                check(prefs.transferSkipExisting, 'transferSkipExisting')
              )}
              {row(
                t('فقط جدیدترها'),
                t('اگر فایل مقصد جدیدتر یا هم‌زمان باشد، منتقل نشود'),
                check(prefs.transferNewerOnly, 'transferNewerOnly')
              )}
              {row(
                t('محدودیت سرعت'),
                t('کیلوبایت بر ثانیه؛ ۰ یعنی بی‌نهایت'),
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
                {t('فیلترها روی هر سه مسیر کپی/انتقال (دکمه‌ها، کلیدها و کشیدن‌و‌رهاکردن) اعمال می‌شوند و تعداد فایل‌های رد‌شده در نوار عملیات‌ها نوشته می‌شود.')}
              </div>
            </>
          )}

          {page === 'operations' && (
            <>
              {row(
                t('دوبار کلیک روی فایل'),
                null,
                seg(
                  prefs.doubleClick,
                  [
                    { v: 'open', label: t('اجرا') },
                    { v: 'gallery', label: t('گالری') },
                    { v: 'preview', label: t('پیش‌نمایش') }
                  ],
                  'doubleClick'
                )
              )}
              {row(t('تأیید پیش از حذف'), t('پرسش قبل از سطل بازیافت یا حذف قطعی'), check(prefs.confirmDelete, 'confirmDelete'))}
              {row(t('حذف پیش‌فرض به سطل بازیافت'), t('خاموش = حذف قطعی'), check(prefs.trashByDefault, 'trashByDefault'))}
            </>
          )}

          {page === 'launch' && (
            <>
              {row(
                t('کلید سراسری باز کردن'),
                t('روی X11 کار می‌کند؛ روی Wayland باید همان کلید را در تنظیمات KDE به «Add Command» بدهی (راهنما در docs/INTEGRATION.md)'),
                check(prefs.hotkeyEnabled, 'hotkeyEnabled')
              )}
              {row(
                t('ترکیب کلید'),
                t('مثال: Super+E یا Ctrl+Alt+M'),
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
                t('تک‌نمونه (single instance)'),
                t('اجرای دوباره، پنجرهٔ موجود را جلو می‌آورد · با راه‌اندازی بعدی اعمال می‌شود'),
                check(prefs.singleInstance, 'singleInstance')
              )}
              {row(
                t('پوشهٔ شروع'),
                t('خالی = همان نشست قبلی'),
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
                {t('پک‌های آیکون افزوده‌شده:')} {prefs.iconDirs.length ? prefs.iconDirs.join(' · ') : t('هیچ')}
              </div>
              <div className="hint">{t('تنظیمات در')} <code>state.json</code> {t('کنار پروفایل برنامه ذخیره می‌شود؛ رنگ و آیکون هر پوشه در فایل')} <code>.mfm.json</code> {t('داخل خود پوشه.')}</div>
              <div className="hint">
                {t('دسته‌های بعدی طبق نقشهٔ راه (docs/PREFERENCES.md): ستون‌های سفارشی، نوار ابزار و کلیدها، فیلتر و مرتب‌سازی، تب‌ها، درخت پوشه، بایگانی، شبکه.')}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
