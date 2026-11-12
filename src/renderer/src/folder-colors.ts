/**
 * Folder colours. The values match Pure's coloured folder variants (plus teal/black), so a folder
 * painted from the context menu renders with the pack's own icon instead of a tinted glyph.
 */
export type FolderColor = { value: string; name: string }

export const FOLDER_COLORS: FolderColor[] = [
  { value: '#e0564d', name: 'قرمز' },
  { value: '#e08b39', name: 'نارنجی' },
  { value: '#d8b93f', name: 'زرد' },
  { value: '#4fb56a', name: 'سبز' },
  { value: '#4f8ff0', name: 'آبی' },
  { value: '#9a6ee0', name: 'بنفش' },
  { value: '#dd6b9c', name: 'صورتی' },
  { value: '#2aa9a0', name: 'فیروزه‌ای' },
  { value: '#2f353d', name: 'مشکی' },
  { value: '#8a93a3', name: 'خاکستری' }
]
