/**
 * Colour themes on top of light/dark. Each id has a palette block in `style.css`
 * (`:root[data-color-theme='<id>']`), while the label is a translation key.
 *
 * `accent` and `surface` are only preview swatches for the settings grid; the real
 * values live in CSS so the theme works in both tones.
 */
export type ColorTheme = {
  id: string
  label: string
  accent: string
  surface: string
}

export const COLOR_THEMES: ColorTheme[] = [
  { id: 'default', label: 'پیش‌فرض', accent: '#5b93ff', surface: '#1a1d23' },
  { id: 'wine', label: 'شرابی', accent: '#e0727c', surface: '#241a1e' },
  { id: 'midnight', label: 'نیمه‌شب', accent: '#7c8cff', surface: '#1a1d2b' },
  { id: 'charcoal', label: 'زغالی', accent: '#9aa4b5', surface: '#22252a' },
  { id: 'forest', label: 'جنگلی', accent: '#5fca86', surface: '#18231c' },
  { id: 'lilac', label: 'یاسی', accent: '#b487e8', surface: '#211d29' },
  { id: 'mint', label: 'نعنایی', accent: '#4fc9b0', surface: '#172522' },
  { id: 'sand', label: 'شنی', accent: '#d9a45c', surface: '#271f16' },
  { id: 'sky', label: 'آسمانی', accent: '#5aa8e8', surface: '#16212b' },
  { id: 'rose', label: 'گلی', accent: '#e8789f', surface: '#261a21' }
]

export const DEFAULT_COLOR_THEME = 'default'

export const isColorTheme = (id: unknown): id is string =>
  typeof id === 'string' && COLOR_THEMES.some((t) => t.id === id)
