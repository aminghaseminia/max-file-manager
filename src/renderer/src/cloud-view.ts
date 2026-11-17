import type { CloudEntryState, CloudState } from '../../shared/cloud.ts'
import { t } from './i18n.ts'
import { fa } from './format.ts'

/** Persian stays the key; `t()` runs at render so a language switch is immediate. */
export const CLOUD_STATE_LABEL: Record<CloudState | CloudEntryState, string> = {
  idle: 'همگام',
  synced: 'همگام',
  pending: 'در انتظار همگام‌سازی',
  checking: 'بررسی تغییرات',
  syncing: 'در حال همگام‌سازی',
  paused: 'مکث',
  offline: 'آفلاین',
  conflict: 'تعارض',
  error: 'خطا'
}

export const cloudStateLabel = (state: string): string =>
  CLOUD_STATE_LABEL[state as CloudState] ?? CLOUD_STATE_LABEL.error

/** The class the dot/badge takes; the CSS owns the colour. */
export function cloudStateClass(state: string): string {
  if (state === 'conflict') return 'is-conflict'
  if (state === 'syncing' || state === 'checking') return 'is-busy'
  if (state === 'paused') return 'is-paused'
  if (state === 'offline') return 'is-offline'
  if (state === 'error') return 'is-error'
  if (state === 'pending') return 'is-pending'
  return 'is-synced'
}

export const INTERVAL_OPTIONS = [5, 15, 30, 60, 180, 360, 720] as const

export function intervalLabel(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${fa(min)} ${t('دقیقه')}`
  const h = Math.round(min / 60)
  return `${fa(h)} ${t('ساعت')}`
}

/** «۲ دقیقه پیش»، «همین حالا»، «هرگز». */
export function agoLabel(ms: number | null, now = Date.now()): string {
  if (!ms) return t('هرگز')
  const diff = Math.max(0, now - ms)
  const sec = Math.round(diff / 1000)
  if (sec < 45) return t('همین حالا')
  const min = Math.round(sec / 60)
  if (min < 60 && diff < 3_600_000) return `${fa(min)} ${t('دقیقه پیش')}`
  const h = Math.round(min / 60)
  if (h < 24) return `${fa(h)} ${t('ساعت پیش')}`
  const d = Math.round(h / 24)
  return `${fa(d)} ${t('روز پیش')}`
}

/** The one-line description of a binding in the sidebar and the settings page. */
export function bindingSubtitle(
  state: CloudState,
  lastRunAt: number | null,
  conflicts: number,
  now = Date.now()
): string {
  if (state === 'syncing' || state === 'checking') return t('در حال همگام‌سازی…')
  if (state === 'paused') return t('مکث')
  if (state === 'offline') return t('آفلاین')
  if (conflicts > 0) return `${fa(conflicts)} ${t('تعارض')}`
  return agoLabel(lastRunAt, now)
}
