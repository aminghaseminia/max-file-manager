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
