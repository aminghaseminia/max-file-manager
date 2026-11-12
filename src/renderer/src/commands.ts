import { t } from './i18n.ts'
/**
 * One list of commands. The toolbar, the function-key bar and the shortcut editor all read
 * from here, so adding a command means one line and it shows up everywhere.
 */
export type CommandId =
  | 'copy'
  | 'move'
  | 'copyFiles'
  | 'cutFiles'
  | 'paste'
  | 'edit'
  | 'rename'
  | 'batchRename'
  | 'mkdir'
  | 'trash'
  | 'hardDelete'
  | 'size'
  | 'refresh'
  | 'up'
  | 'previewPane'
  | 'gallery'
  | 'flat'
  | 'dupes'
  | 'sync'
  | 'diff'
  | 'undo'
  | 'selectAll'
  | 'filter'
  | 'hidden'
  | 'bookmark'
  | 'newTab'
  | 'closeTab'
  | 'reopenTab'
  | 'nextTab'
  | 'addressBar'
  | 'toggleView'
  | 'toggleLayout'
  | 'terminal'
  | 'reveal'
  | 'checkUpdate'
  | 'indexSizes'
  | 'searchIndex'
  | 'presets'
  | 'saveFormat'
  | 'look'
  | 'properties'
  | 'compress'
  | 'extract'
  | 'prefs'

export type CommandGroup = 'transfer' | 'file' | 'view' | 'tab' | 'window'

export type CommandDef = { id: CommandId; label: string; key: string; group: CommandGroup }

export const COMMANDS: CommandDef[] = [
  { id: 'copy', label: 'کپی به مقصد', key: 'F5', group: 'transfer' },
  { id: 'copyFiles', label: 'کپی فایل', key: 'Ctrl+C', group: 'file' },
  { id: 'cutFiles', label: 'برش فایل', key: 'Ctrl+X', group: 'file' },
  { id: 'paste', label: 'چسباندن فایل', key: 'Ctrl+V', group: 'file' },
  { id: 'move', label: 'انتقال به مقصد', key: 'F6', group: 'transfer' },
  { id: 'edit', label: 'ویرایش متن', key: 'F4', group: 'file' },
  { id: 'rename', label: 'تغییر نام', key: 'F2', group: 'file' },
  { id: 'batchRename', label: 'تغییر نام گروهی', key: 'Shift+F2', group: 'file' },
  { id: 'mkdir', label: 'پوشهٔ نو', key: 'F7', group: 'file' },
  { id: 'trash', label: 'به سطل بازیافت', key: 'F8', group: 'file' },
  { id: 'hardDelete', label: 'حذف قطعی', key: 'Shift+Delete', group: 'file' },
  { id: 'size', label: 'محاسبهٔ اندازه', key: 'F9', group: 'file' },
  { id: 'sync', label: 'همگام‌سازی با پنجرهٔ مقابل', key: 'Ctrl+Shift+Y', group: 'transfer' },
  { id: 'diff', label: 'مقایسهٔ دو فایل', key: 'Ctrl+Shift+Z', group: 'file' },
  { id: 'undo', label: 'واگرد', key: 'Ctrl+Z', group: 'file' },
  { id: 'selectAll', label: 'انتخاب همه', key: 'Ctrl+A', group: 'file' },
  { id: 'refresh', label: 'تازه‌سازی', key: 'Ctrl+R', group: 'view' },
  { id: 'up', label: 'پوشهٔ بالاتر', key: 'Backspace', group: 'view' },
  { id: 'previewPane', label: 'پیش‌نمایش', key: 'F3', group: 'view' },
  { id: 'gallery', label: 'گالری', key: 'Space', group: 'view' },
  { id: 'flat', label: 'فهرست تخت', key: 'Ctrl+Shift+F', group: 'view' },
  { id: 'dupes', label: 'فایل‌های تکراری', key: 'Ctrl+Shift+D', group: 'view' },
  { id: 'compress', label: 'فشرده‌سازی…', key: '', group: 'file' },
  { id: 'extract', label: 'استخراج آرشیو…', key: '', group: 'file' },
  { id: 'filter', label: 'فیلتر نام', key: 'Ctrl+F', group: 'view' },
  { id: 'hidden', label: 'فایل‌های مخفی', key: 'Ctrl+H', group: 'view' },
  { id: 'bookmark', label: 'نشان‌کردن', key: 'Ctrl+D', group: 'view' },
  { id: 'toggleView', label: 'لیست/شبکه', key: 'Ctrl+Shift+V', group: 'view' },
  { id: 'toggleLayout', label: 'یک/دو پنجره', key: 'Ctrl+Shift+L', group: 'window' },
  { id: 'newTab', label: 'تب نو', key: 'Ctrl+T', group: 'tab' },
  { id: 'closeTab', label: 'بستن تب', key: 'Ctrl+W', group: 'tab' },
  { id: 'reopenTab', label: 'تب بسته‌شده', key: 'Ctrl+Shift+T', group: 'tab' },
  { id: 'nextTab', label: 'تب بعدی', key: 'Ctrl+Tab', group: 'tab' },
  { id: 'addressBar', label: 'نوار آدرس', key: 'Ctrl+L', group: 'window' },
  { id: 'terminal', label: 'ترمینال اینجا', key: 'Ctrl+Alt+T', group: 'window' },
  { id: 'reveal', label: 'نمایش در فایل‌منیجر سیستم', key: '', group: 'window' },
  { id: 'checkUpdate', label: 'بررسی به‌روزرسانی', key: '', group: 'window' },
  { id: 'indexSizes', label: 'اندازه از ایندکس (سریع)', key: '', group: 'file' },
  { id: 'searchIndex', label: 'جست‌وجوی گلوبال', key: 'Ctrl+K', group: 'view' },
  { id: 'presets', label: 'چیدمان‌ها و فیلترها', key: 'Ctrl+Shift+P', group: 'window' },
  { id: 'saveFormat', label: 'قالب نمایش این پوشه', key: '', group: 'view' },
  { id: 'look', label: 'آیکون پوشه', key: '', group: 'view' },
  { id: 'properties', label: 'ویژگی‌ها', key: 'Alt+Enter', group: 'file' },
  { id: 'prefs', label: 'تنظیمات', key: 'Ctrl+,', group: 'window' }
]

export const GROUP_ORDER: CommandGroup[] = ['transfer', 'file', 'view', 'tab', 'window']

export const groupLabelOf = (g: CommandGroup): string => t(GROUP_LABEL[g])

export const labelOf = (c: { label: string } | undefined): string => (c ? t(c.label) : '')

export const COMMAND_BY_ID: Record<string, CommandDef> = Object.fromEntries(
  COMMANDS.map((c) => [c.id, c])
)

export const DEFAULT_SHORTCUTS: Record<string, string> = Object.fromEntries(
  COMMANDS.map((c) => [c.id, c.key])
)

export const GROUP_LABEL: Record<CommandGroup, string> = {
  transfer: 'انتقال',
  file: 'فایل',
  view: 'نمایش',
  tab: 'تب',
  window: 'پنجره'
}
