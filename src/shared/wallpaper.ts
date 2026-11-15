/** Formats Plasma's own wallpaper command accepts; SVG/ICO are images but not valid wallpapers. */
const WALLPAPER_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'])

/** `ext` is what `Entry.ext` carries: no leading dot, case already irrelevant. */
export const isWallpaperExt = (ext: string): boolean =>
  WALLPAPER_EXT.has(String(ext).toLowerCase().replace(/^\./, ''))

/** Exactly the modes `plasma-apply-wallpaperimage -f` understands — anything else is refused. */
export const WALLPAPER_FILL_MODES = [
  'preserveAspectCrop',
  'stretch',
  'preserveAspectFit',
  'tile',
  'tileVertically',
  'tileHorizontally',
  'pad'
] as const

export type WallpaperFillMode = (typeof WALLPAPER_FILL_MODES)[number]

export const isWallpaperFillMode = (v: unknown): v is WallpaperFillMode =>
  typeof v === 'string' && (WALLPAPER_FILL_MODES as readonly string[]).includes(v)

/** Persian labels paired one-to-one with the modes; the i18n catalogue translates them at render. */
export const WALLPAPER_FILL_LABELS: Record<WallpaperFillMode, string> = {
  preserveAspectCrop: 'پرکردن کادر (برش لبه‌ها)',
  stretch: 'کشیده تا پر کند',
  preserveAspectFit: 'کامل با حفظ نسبت',
  tile: 'کاشی',
  tileVertically: 'کاشی عمودی',
  tileHorizontally: 'کاشی افقی',
  pad: 'وسط‌چین با حاشیه'
}
