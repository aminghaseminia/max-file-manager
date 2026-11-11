import { t } from './i18n.ts'
import { useState } from 'react'
import type { NamedLayout } from './prefs'
import { fa } from './format'
import { XIcon } from './Icons'

type Props = {
  layouts: Record<string, NamedLayout>
  filters: Record<string, string>
  currentFilter: string
  onSaveLayout(name: string): void
  onApplyLayout(name: string): void
  onDeleteLayout(name: string): void
  onSaveFilter(name: string, pattern: string): void
  onApplyFilter(pattern: string): void
  onDeleteFilter(name: string): void
  onClose(): void
}

/** Named layouts (window shape) and named name-filters, in one place. */
export function PresetsDialog({
  layouts,
  filters,
  currentFilter,
  onSaveLayout,
  onApplyLayout,
  onDeleteLayout,
  onSaveFilter,
  onApplyFilter,
  onDeleteFilter,
  onClose
}: Props) {
  const [tab, setTab] = useState<'layouts' | 'filters'>('layouts')
  const [layoutName, setLayoutName] = useState('')
  const [filterName, setFilterName] = useState('')
  const [filterText, setFilterText] = useState(currentFilter)

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="dialog presets-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">{t(t('چیدمان‌ها و فیلترها'))}</div>
        <div className="seg">
          <button className={tab === 'layouts' ? 'on' : ''} onClick={() => setTab('layouts')}>
            چیدمان‌ها
          </button>
          <button className={tab === 'filters' ? 'on' : ''} onClick={() => setTab('filters')}>
            فیلترها
          </button>
        </div>

        {tab === 'layouts' ? (
          <>
            <div className="preset-list">
              {Object.keys(layouts).length === 0 && <div className="dim">{t(t('چیدمانی ذخیره نشده'))}</div>}
              {Object.entries(layouts).map(([name, l]) => (
                <div className="preset-row" key={name}>
                  <span className="preset-name">{name}</span>
                  <span className="dim preset-desc">
                    {l.layout === 'single' ? t('تک‌پنجره') : t('دوپنجره')} ·{' '}
                    {l.view === 'grid' ? t('شبکه') : t('فهرست')} · {fa((l.columns ?? []).length)} ستون
                  </span>
                  <button className="btn ghost" onClick={() => onApplyLayout(name)}>
                    اعمال
                  </button>
                  <button className="tb" title={t(t('حذف'))} onClick={() => onDeleteLayout(name)}>
                    <XIcon size={11} />
                  </button>
                </div>
              ))}
            </div>
            <div className="preset-save">
              <input
                className="pref-input"
                placeholder={t(t('نام چیدمان تازه'))}
                value={layoutName}
                onChange={(e) => setLayoutName(e.target.value)}
              />
              <button
                className="btn"
                disabled={!layoutName.trim()}
                onClick={() => {
                  onSaveLayout(layoutName.trim())
                  setLayoutName('')
                }}
              >
                ذخیرهٔ چیدمان فعلی
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="preset-list">
              {Object.keys(filters).length === 0 && <div className="dim">{t(t('فیلتری ذخیره نشده'))}</div>}
              {Object.entries(filters).map(([name, pattern]) => (
                <div className="preset-row" key={name}>
                  <span className="preset-name">{name}</span>
                  <span className="dim preset-desc" dir="ltr">
                    {pattern}
                  </span>
                  <button className="btn ghost" onClick={() => onApplyFilter(pattern)}>
                    اعمال
                  </button>
                  <button className="tb" title={t(t('حذف'))} onClick={() => onDeleteFilter(name)}>
                    <XIcon size={11} />
                  </button>
                </div>
              ))}
            </div>
            <div className="preset-save">
              <input
                className="pref-input"
                placeholder={t(t('نام فیلتر'))}
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
              />
              <input
                className="pref-input wide"
                dir="ltr"
                placeholder={t(t('*.log یا #red یا *3'))}
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
              <button
                className="btn"
                disabled={!filterName.trim() || !filterText.trim()}
                onClick={() => {
                  onSaveFilter(filterName.trim(), filterText.trim())
                  setFilterName('')
                }}
              >
                ذخیره
              </button>
            </div>
          </>
        )}

        <div className="dialog-actions">
          <button className="btn ghost" onClick={onClose}>
            <XIcon size={11} /> بستن
          </button>
        </div>
      </div>
    </div>
  )
}
