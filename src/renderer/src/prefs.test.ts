import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_FONT_FAMILY, DEFAULTS, cleanFontFamily, fontStack, mergePrefs, migrateLegacy } from './prefs.ts'

test('mergePrefs fills defaults and rejects nonsense', () => {
  const p = mergePrefs({ theme: 'neon' as any, layout: 'triple' as any, foldersFirst: undefined })
  assert.equal(p.theme, 'dark')
  assert.equal(p.layout, 'dual')
  assert.equal(p.dualSplit, 0.5)
  assert.equal(p.foldersFirst, true)
  assert.equal(p.titlebar, 'app')
  assert.deepEqual(p.iconDirs, [])
})

test('mergePrefs keeps real values and coerces booleans', () => {
  const p = mergePrefs({ theme: 'light', layout: 'single', sidebar: 'float', rounded: false, dualSplit: 0.65 })
  assert.equal(p.theme, 'light')
  assert.equal(p.layout, 'single')
  assert.equal(p.sidebar, 'float')
  assert.equal(p.rounded, false)
  assert.equal(p.dualSplit, 0.65)
  assert.equal(p.confirmDelete, DEFAULTS.confirmDelete)
  assert.equal(mergePrefs({ dualSplit: 0.95 }).dualSplit, 0.8)
  assert.equal(mergePrefs({ dualSplit: 0.05 }).dualSplit, 0.2)
})

test('language: English is the default, Persian survives, nonsense falls back', () => {
  assert.equal(mergePrefs({}).lang, 'en')
  assert.equal(mergePrefs({ lang: 'fa' }).lang, 'fa')
  assert.equal(mergePrefs({ lang: 'de' as never }).lang, 'en')
})

test('file icons: bundled Pure by default, old “theme” becomes the OS theme', () => {
  assert.equal(mergePrefs({}).fileIcons, 'pure')
  assert.equal(mergePrefs({ fileIcons: 'pure' }).fileIcons, 'pure')
  assert.equal(mergePrefs({ fileIcons: 'system' }).fileIcons, 'system')
  assert.equal(mergePrefs({ fileIcons: 'line' }).fileIcons, 'line')
  assert.equal(mergePrefs({ fileIcons: 'theme' as never }).fileIcons, 'system')
  assert.equal(mergePrefs({ fileIcons: 'neon' as never }).fileIcons, 'pure')
})

test('mergePrefs drops non-string icon dirs', () => {
  const p = mergePrefs({ iconDirs: ['/icons', 42 as any, ''] })
  assert.deepEqual(p.iconDirs, ['/icons'])
})

test('migrateLegacy folds the old top-level keys into prefs', () => {
  const p = migrateLegacy({
    theme: 'light',
    view: 'grid',
    hidden: true,
    chrome: { customTitlebar: false, rounded: false },
    ui: { sidebar: 'float', sidebarOpen: false, iconDirs: ['/p'], iconTheme: 'breeze' }
  })
  assert.deepEqual(p, {
    theme: 'light',
    view: 'grid',
    showHidden: true,
    titlebar: 'system',
    rounded: false,
    sidebar: 'float',
    sidebarOpen: false,
    iconDirs: ['/p'],
    iconTheme: 'breeze'
  })
})

test('named layouts, filters and file-type colours survive only in valid form', () => {
  const p = mergePrefs({
    layouts: {
      good: { layout: 'single', view: 'grid', columns: ['size', 'bogus'], sidebar: 'float' },
      bad: 'nope'
    } as never,
    filters: { تصاویر: '*.jpg', empty: '   ' } as never,
    fileTypes: { PDF: '#4f8ff0', '.txt': '#4fb56a', bad: 'red', evil: '#zzzzzz' } as never
  })
  assert.deepEqual(Object.keys(p.layouts), ['good'])
  assert.deepEqual(p.layouts.good.columns, ['size'], 'unknown columns are dropped')
  assert.equal(p.layouts.good.layout, 'single')
  assert.deepEqual(Object.keys(p.filters), ['تصاویر'])
  assert.deepEqual(p.fileTypes, { pdf: '#4f8ff0', txt: '#4fb56a' })
})

test('fontFamily: empty by default, trimmed, and never breaks the declaration', () => {
  assert.equal(mergePrefs({}).fontFamily, '')
  assert.equal(mergePrefs({ fontFamily: '  Inter  ' }).fontFamily, 'Inter')
  assert.equal(mergePrefs({ fontFamily: 42 as never }).fontFamily, '')
  assert.equal(cleanFontFamily('Inter; color: red'), 'Inter color: red')
  assert.equal(cleanFontFamily('x{}()<>\\/y'), 'xy')
  assert.ok(cleanFontFamily('a'.repeat(300)).length <= 120)
})

test('fontStack keeps a full stack and gives a single family a Persian fallback', () => {
  assert.equal(fontStack(''), DEFAULT_FONT_FAMILY)
  assert.match(fontStack('Inter'), /^Inter, Vazirmatn/)
  assert.equal(fontStack('Inter, sans-serif'), 'Inter, sans-serif')
})
