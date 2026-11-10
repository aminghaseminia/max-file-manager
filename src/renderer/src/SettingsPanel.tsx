import type { Chrome } from './api'

export type UiPrefs = {
  sidebar: 'docked' | 'float'
  sidebarOpen: boolean
  /** user-added icon pack folders */
  iconDirs?: string[]
  iconTheme?: string
}

type Props = {
  chrome: Chrome
  ui: UiPrefs
  theme: 'dark' | 'light'
  onChrome(c: Chrome): void
  onUi(patch: Partial<UiPrefs>): void
  onTheme(t: 'dark' | 'light'): void
  onClose(): void
}

export function SettingsPanel({ chrome, ui, theme, onChrome, onUi, onTheme, onClose }: Props) {
  return (
    <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
      <div className="set-head">
        <span>تنظیمات</span>
        <span className="spacer" />
        <button className="tb" title="بستن" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="set-row">
        <span className="set-label">تایتل‌بار</span>
        <div className="seg">
          <button className={chrome.customTitlebar ? '' : 'on'} onClick={() => onChrome({ ...chrome, customTitlebar: false })}>
            سیستم
          </button>
          <button className={chrome.customTitlebar ? 'on' : ''} onClick={() => onChrome({ ...chrome, customTitlebar: true })}>
            برنامه
          </button>
        </div>
      </div>

      <div className="set-row">
        <span className="set-label">گوشه‌های گرد پنجره</span>
        <label className="check">
          <input
            type="checkbox"
            checked={chrome.rounded}
            disabled={!chrome.customTitlebar}
            onChange={(e) => onChrome({ ...chrome, rounded: e.target.checked })}
          />
        </label>
      </div>
      {!chrome.customTitlebar && (
        <div className="hint">گوشه‌های گرد فقط با تایتل‌بار برنامه ممکن است (قاب سیستم‌عامل گرد نمی‌شود).</div>
      )}

      <div className="set-row">
        <span className="set-label">سایدبار</span>
        <div className="seg">
          <button className={ui.sidebar === 'docked' ? 'on' : ''} onClick={() => onUi({ sidebar: 'docked' })}>
            چسبیده
          </button>
          <button className={ui.sidebar === 'float' ? 'on' : ''} onClick={() => onUi({ sidebar: 'float' })}>
            شناور
          </button>
        </div>
      </div>

      <div className="set-row">
        <span className="set-label">نمایش سایدبار</span>
        <label className="check">
          <input
            type="checkbox"
            checked={ui.sidebarOpen}
            onChange={(e) => onUi({ sidebarOpen: e.target.checked })}
          />
        </label>
      </div>

      <div className="set-row">
        <span className="set-label">تم</span>
        <div className="seg">
          <button className={theme === 'dark' ? 'on' : ''} onClick={() => onTheme('dark')}>
            تیره
          </button>
          <button className={theme === 'light' ? 'on' : ''} onClick={() => onTheme('light')}>
            روشن
          </button>
        </div>
      </div>

      <div className="hint">تغییر تایتل‌بار و گوشه‌ها، پنجره را بازسازی می‌کند.</div>
    </div>
  )
}
