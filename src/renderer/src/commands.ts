/**
 * One list of commands. The toolbar, the function-key bar and the shortcut editor all read
 * from here, so adding a command means one line and it shows up everywhere.
 */
export type CommandId =
  | 'copy'
  | 'move'
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
  | 'prefs'

export type CommandGroup = 'transfer' | 'file' | 'view' | 'tab' | 'window'

export type CommandDef = { id: CommandId; label: string; key: string; group: CommandGroup }

export const COMMANDS: CommandDef[] = [
  { id: 'copy', label: 'کپی به مقصد', key: 'F5', group: 'transfer' },
  { id: 'move', label: 'انتقال به مقصد', key: 'F6', group: 'transfer' },
  { id: 'edit', label: 'ویرایش متن', key: 'F4', group: 'file' },
  { id: 'rename', label: 'تغییر نام', key: 'F2', group: 'file' },
  { id: 'batchRename', label: 'تغییر نام گروهی', key: 'Shift+F2', group: 'file' },
  { id: 'mkdir', label: 'پوشهٔ نو', key: 'F7', group: 'file' },
  { id: 'trash', label: 'به سطل بازیافت', key: 'F8', group: 'file' },
  { id: 'hardDelete', label: 'حذف قطعی', key: 'Shift+Delete', group: 'file' },
  { id: 'size', label: 'محاسبهٔ اندازه', key: 'F9', group: 'file' },
  { id: 'undo', label: 'واگرد', key: 'Ctrl+Z', group: 'file' },
  { id: 'selectAll', label: 'انتخاب همه', key: 'Ctrl+A', group: 'file' },
  { id: 'refresh', label: 'تازه‌سازی', key: 'Ctrl+R', group: 'view' },
  { id: 'up', label: 'پوشهٔ بالاتر', key: 'Backspace', group: 'view' },
  { id: 'previewPane', label: 'پیش‌نمایش', key: 'F3', group: 'view' },
  { id: 'gallery', label: 'گالری', key: 'Space', group: 'view' },
  { id: 'flat', label: 'فهرست تخت', key: 'Ctrl+Shift+F', group: 'view' },
  { id: 'dupes', label: 'فایل‌های تکراری', key: 'Ctrl+Shift+D', group: 'view' },
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
  { id: 'prefs', label: 'تنظیمات', key: 'Ctrl+,', group: 'window' }
]

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
