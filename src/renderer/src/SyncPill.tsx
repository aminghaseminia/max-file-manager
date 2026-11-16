import type { SyncMode } from './api'
import { t } from './i18n.ts'
import { ArrowLeftIcon, ArrowRightIcon, SwapIcon } from './Icons'

/**
 * The three direction buttons that live on the pane divider. They only appear on hover/focus of the
 * splitter: the divider is 6 px and the panes must not lose horizontal space to a permanent rail.
 * `onPointerDown` is stopped so a click never starts the column-resize drag.
 */
export function SyncPill({
  mode,
  leftName,
  rightName,
  onPick
}: {
  mode: SyncMode
  leftName: string
  rightName: string
  onPick(mode: SyncMode): void
}) {
  const stop = (e: React.SyntheticEvent): void => e.stopPropagation()
  return (
    <div
      className="sync-pill"
      onPointerDown={stop}
      onMouseDown={stop}
      onDoubleClick={stop}
      role="group"
      aria-label={t('جهت همگام‌سازی')}
    >
      <button
        className={'tb' + (mode === 'ltr' ? ' on' : '')}
        title={`${t('همگام‌سازی')}: ${leftName} → ${rightName}`}
        aria-label={t('از چپ به راست')}
        onClick={() => onPick('ltr')}
      >
        <ArrowRightIcon size={12} />
      </button>
      <button
        className={'tb' + (mode === 'both' ? ' on' : '')}
        title={t('همگام‌سازی دوطرفه')}
        aria-label={t('دوطرفه')}
        onClick={() => onPick('both')}
      >
        <SwapIcon size={12} />
      </button>
      <button
        className={'tb' + (mode === 'rtl' ? ' on' : '')}
        title={`${t('همگام‌سازی')}: ${rightName} → ${leftName}`}
        aria-label={t('از راست به چپ')}
        onClick={() => onPick('rtl')}
      >
        <ArrowLeftIcon size={12} />
      </button>
    </div>
  )
}
