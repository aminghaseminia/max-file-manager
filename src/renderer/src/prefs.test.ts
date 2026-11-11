import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULTS, mergePrefs, migrateLegacy } from './prefs.ts'

test('mergePrefs fills defaults and rejects nonsense', () => {
  const p = mergePrefs({ theme: 'neon' as any, layout: 'triple' as any, foldersFirst: undefined })
  assert.equal(p.theme, 'dark')
  assert.equal(p.layout, 'dual')
  assert.equal(p.foldersFirst, true)
  assert.equal(p.titlebar, 'app')
  assert.deepEqual(p.iconDirs, [])
})

test('mergePrefs keeps real values and coerces booleans', () => {
  const p = mergePrefs({ theme: 'light', layout: 'single', sidebar: 'float', rounded: false })
  assert.equal(p.theme, 'light')
  assert.equal(p.layout, 'single')
  assert.equal(p.sidebar, 'float')
  assert.equal(p.rounded, false)
  assert.equal(p.confirmDelete, DEFAULTS.confirmDelete)
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
