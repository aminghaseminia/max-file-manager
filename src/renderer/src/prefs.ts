export type View = 'list' | 'grid'
export type Layout = 'dual' | 'single'
export type DoubleClick = 'open' | 'gallery' | 'preview'

/**
 * Every user-facing option in one place, mirroring the categories Directory Opus, Krusader and
 * FreeCommander use (see docs/PREFERENCES.md). Anything not listed here is not configurable yet.
 */
export type Prefs = {
  // appearance
  theme: 'dark' | 'light'
  view: View
  foldersFirst: boolean
  showHidden: boolean
  showTypeColumn: boolean
  // window
  titlebar: 'app' | 'system'
  rounded: boolean
  layout: Layout
  sidebar: 'docked' | 'float'
  sidebarOpen: boolean
  // file operations
  doubleClick: DoubleClick
  confirmDelete: boolean
  trashByDefault: boolean
  // launching
  singleInstance: boolean
  /** '' means: reopen the last session */
  startFolder: string
  // icon packs (folder look)
  iconDirs: string[]
  iconTheme: string
}

export const DEFAULTS: Prefs = {
  theme: 'dark',
  view: 'list',
  foldersFirst: true,
  showHidden: false,
  showTypeColumn: true,
  titlebar: 'app',
  rounded: true,
  layout: 'dual',
  sidebar: 'docked',
  sidebarOpen: true,
  doubleClick: 'gallery',
  confirmDelete: true,
  trashByDefault: true,
  singleInstance: true,
  startFolder: '',
  iconDirs: [],
  iconTheme: ''
}

/** Coerces whatever is on disk into a valid Prefs object — a bad value must never crash a boot. */
export function mergePrefs(raw: Partial<Prefs> | null | undefined): Prefs {
  const p = { ...DEFAULTS, ...(raw ?? {}) }
  return {
    theme: p.theme === 'light' ? 'light' : 'dark',
    view: p.view === 'grid' ? 'grid' : 'list',
    foldersFirst: p.foldersFirst !== false,
    showHidden: p.showHidden === true,
    showTypeColumn: p.showTypeColumn !== false,
    titlebar: p.titlebar === 'system' ? 'system' : 'app',
    rounded: p.rounded !== false,
    layout: p.layout === 'single' ? 'single' : 'dual',
    sidebar: p.sidebar === 'float' ? 'float' : 'docked',
    sidebarOpen: p.sidebarOpen !== false,
    doubleClick: p.doubleClick === 'gallery' || p.doubleClick === 'preview' ? p.doubleClick : 'open',
    confirmDelete: p.confirmDelete !== false,
    trashByDefault: p.trashByDefault !== false,
    singleInstance: p.singleInstance !== false,
    startFolder: typeof p.startFolder === 'string' ? p.startFolder : '',
    iconDirs: Array.isArray(p.iconDirs) ? p.iconDirs.filter((d) => typeof d === 'string' && d) : [],
    iconTheme: typeof p.iconTheme === 'string' ? p.iconTheme : ''
  }
}

/** Old state files kept theme/view/hidden/chrome/ui at the top level; fold them into prefs. */
export function migrateLegacy(s: any): Partial<Prefs> {
  const p: Partial<Prefs> = {}
  if (s?.theme === 'light' || s?.theme === 'dark') p.theme = s.theme
  if (s?.view === 'grid' || s?.view === 'list') p.view = s.view
  if (typeof s?.hidden === 'boolean') p.showHidden = s.hidden
  if (s?.chrome) {
    p.titlebar = s.chrome.customTitlebar === false ? 'system' : 'app'
    p.rounded = s.chrome.rounded !== false
  }
  if (s?.ui) {
    if (s.ui.sidebar === 'float') p.sidebar = 'float'
    if (s.ui.sidebarOpen === false) p.sidebarOpen = false
    if (Array.isArray(s.ui.iconDirs)) p.iconDirs = s.ui.iconDirs.filter((d: unknown) => typeof d === 'string')
    if (typeof s.ui.iconTheme === 'string') p.iconTheme = s.ui.iconTheme
  }
  return p
}
