import { t } from './i18n.ts'
import { COMMANDS, COMMAND_BY_ID, DEFAULT_SHORTCUTS } from './commands.ts'

/** The toolbar the app ships with; the user can change it in preferences. */
export const DEFAULT_TOOLBAR = [
  'copy',
  'move',
  'edit',
  'rename',
  'mkdir',
  'trash',
  'size',
  'previewPane',
  'undo',
  'flat',
  'dupes',
  'terminal'
]

export type Lang = 'en' | 'fa'
export type View = 'list' | 'grid'
export type Layout = 'dual' | 'single'
export type DoubleClick = 'open' | 'gallery' | 'preview'
export type ColId = 'type' | 'size' | 'date' | 'mode' | 'owner' | 'links' | 'dims' | 'rating'

/** Optional columns, in the order the user arranged them (name is always first). */
export const colLabel = (id: string): string => {
  const c = COLUMNS.find((x) => x.id === id)
  return c ? t(c.label) : id
}

export const COLUMNS: { id: ColId; label: string }[] = [
  { id: 'type', label: t('نوع') },
  { id: 'size', label: t('اندازه') },
  { id: 'date', label: t('تاریخ') },
  { id: 'mode', label: t('مجوز') },
  { id: 'owner', label: t('مالک') },
  { id: 'links', label: t('لینک') },
  { id: 'dims', label: t('ابعاد') },
  { id: 'rating', label: t('امتیاز') }
]

/**
 * Every user-facing option in one place, mirroring the categories Directory Opus, Krusader and
 * FreeCommander use (see docs/PREFERENCES.md). Anything not listed here is not configurable yet.
 */
export type Prefs = {
  /** UI language; English is the default */
  lang: Lang
  // appearance
  theme: 'dark' | 'light'
  view: View
  foldersFirst: boolean
  showHidden: boolean
  columns: ColId[]
  sizeFormat: 'human' | 'bytes'
  dateFormat: 'iso' | 'jalali' | 'short'
  showSeconds: boolean
  // window
  titlebar: 'app' | 'system'
  rounded: boolean
  layout: Layout
  sidebar: 'docked' | 'float'
  sidebarOpen: boolean
  /** command id → accelerator text; '' means the command has no key */
  shortcuts: Record<string, string>
  /** command ids shown as buttons in the toolbar, in order */
  toolbar: string[]
  // tabs
  newTabPos: 'end' | 'next'
  middleClickClosesTab: boolean
  // archives, gallery and preview
  zipLevel: number
  imageFormat: 'png' | 'jpeg' | 'webp'
  /** 50..100, only used for jpeg/webp */
  imageQuality: number
  slideshowSec: number
  galleryLoop: boolean
  previewMaxKB: number
  /** named window layouts (Opus «Layouts/Styles») */
  layouts: Record<string, NamedLayout>
  /** named name filters shown in the presets dialog */
  filters: Record<string, string>
  /** extension → colour for the small type dot */
  fileTypes: Record<string, string>
  /** folders the indexer walks (empty = the OS defaults at runtime) */
  searchRoots: string[]
  /** glob-ish names/paths the indexer skips */
  searchExclude: string[]
  /** show a folder tree inside every pane (Opus «Dual Tree») */
  paneTree: boolean
  /** user commands: name → shell line, `{path}` and `{dir}` are substituted */
  scripts: Record<string, string>
  // transfer filters
  transferSkipExisting: boolean
  transferNewerOnly: boolean
  /** KB/s ceiling for transfers, 0 = unlimited */
  speedLimitKB: number
  // file operations
  doubleClick: DoubleClick
  confirmDelete: boolean
  trashByDefault: boolean
  // launching
  singleInstance: boolean
  hotkey: string
  hotkeyEnabled: boolean
  /** '' means: reopen the last session */
  startFolder: string
  // icon packs (folder look)
  iconDirs: string[]
  iconTheme: string
}

export const DEFAULTS: Prefs = {
  lang: 'en',
  theme: 'dark',
  view: 'list',
  foldersFirst: true,
  showHidden: false,
  columns: ['type', 'size', 'date'],
  sizeFormat: 'human',
  dateFormat: 'iso',
  showSeconds: false,
  titlebar: 'app',
  rounded: true,
  layout: 'dual',
  sidebar: 'docked',
  sidebarOpen: true,
  shortcuts: DEFAULT_SHORTCUTS,
  toolbar: DEFAULT_TOOLBAR,
  newTabPos: 'next',
  middleClickClosesTab: true,
  doubleClick: 'gallery',
  zipLevel: 6,
  imageFormat: 'png',
  imageQuality: 90,
  slideshowSec: 3,
  galleryLoop: true,
  previewMaxKB: 200,
  layouts: {},
  filters: {},
  fileTypes: {},
  searchRoots: [],
  searchExclude: ['node_modules', '.git', '.cache', '.venv', 'dist', 'build', '*.tmp', '.Trash', 'snap'],
  paneTree: false,
  scripts: {},
  transferSkipExisting: false,
  transferNewerOnly: false,
  speedLimitKB: 0,
  confirmDelete: true,
  trashByDefault: true,
  singleInstance: true,
  hotkey: 'Super+E',
  hotkeyEnabled: false,
  startFolder: '',
  iconDirs: [],
  iconTheme: ''
}

export type NamedLayout = {
  layout?: 'dual' | 'single'
  sidebar?: 'docked' | 'float'
  sidebarOpen?: boolean
  view?: 'list' | 'grid'
  columns?: string[]
  toolbar?: string[]
}

const COLS = new Set(['type', 'size', 'date', 'mode', 'owner', 'links', 'dims', 'rating'])

function normalLayouts(raw: unknown): Record<string, NamedLayout> {
  const out: Record<string, NamedLayout> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!name.trim() || !v || typeof v !== 'object') continue
    const l = v as NamedLayout
    const keep: NamedLayout = {}
    if (l.layout === 'dual' || l.layout === 'single') keep.layout = l.layout
    if (l.sidebar === 'docked' || l.sidebar === 'float') keep.sidebar = l.sidebar
    if (typeof l.sidebarOpen === 'boolean') keep.sidebarOpen = l.sidebarOpen
    if (l.view === 'list' || l.view === 'grid') keep.view = l.view
    if (Array.isArray(l.columns)) keep.columns = l.columns.filter((c) => COLS.has(c))
    if (Array.isArray(l.toolbar)) keep.toolbar = l.toolbar.filter((c) => typeof c === 'string')
    out[name.slice(0, 60)] = keep
  }
  return out
}

function normalFilters(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (name.trim() && typeof v === 'string' && v.trim()) out[name.slice(0, 60)] = v.slice(0, 200)
  }
  return out
}

function normalScripts(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [name, cmd] of Object.entries(raw as Record<string, unknown>)) {
    if (name.trim() && typeof cmd === 'string' && cmd.trim()) out[name.slice(0, 40)] = cmd.slice(0, 500)
  }
  return out
}

function normalFileTypes(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [ext, color] of Object.entries(raw as Record<string, unknown>)) {
    const e = ext.trim().toLowerCase().replace(/^\./, '')
    if (!/^[a-z0-9_+-]{1,16}$/.test(e)) continue
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) out[e] = color
  }
  return out
}

/** Only known commands survive; a missing or garbage value falls back to the default key. */
function normalShortcuts(raw: unknown): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_SHORTCUTS }
  if (raw && typeof raw === 'object') {
    for (const c of COMMANDS) {
      const v = (raw as Record<string, unknown>)[c.id]
      if (typeof v === 'string') out[c.id] = v.trim()
    }
  }
  return out
}

/** Coerces whatever is on disk into a valid Prefs object — a bad value must never crash a boot. */
export function mergePrefs(raw: (Partial<Prefs> & { showTypeColumn?: boolean }) | null | undefined): Prefs {
  const p = { ...DEFAULTS, ...(raw ?? {}) }
  return {
    lang: p.lang === 'fa' ? 'fa' : 'en',
    theme: p.theme === 'light' ? 'light' : 'dark',
    view: p.view === 'grid' ? 'grid' : 'list',
    foldersFirst: p.foldersFirst !== false,
    showHidden: p.showHidden === true,
    columns: normalColumns(p.columns, p.showTypeColumn),
    sizeFormat: p.sizeFormat === 'bytes' ? 'bytes' : 'human',
    dateFormat: p.dateFormat === 'jalali' || p.dateFormat === 'short' ? p.dateFormat : 'iso',
    showSeconds: p.showSeconds === true,
    titlebar: p.titlebar === 'system' ? 'system' : 'app',
    rounded: p.rounded !== false,
    layout: p.layout === 'single' ? 'single' : 'dual',
    sidebar: p.sidebar === 'float' ? 'float' : 'docked',
    sidebarOpen: p.sidebarOpen !== false,
    shortcuts: normalShortcuts(p.shortcuts),
    toolbar: Array.isArray(p.toolbar)
      ? p.toolbar.filter((id) => typeof id === 'string' && COMMAND_BY_ID[id])
      : DEFAULTS.toolbar,
    newTabPos: p.newTabPos === 'end' ? 'end' : 'next',
    middleClickClosesTab: p.middleClickClosesTab !== false,
    doubleClick: p.doubleClick === 'gallery' || p.doubleClick === 'preview' ? p.doubleClick : 'open',
    zipLevel:
      typeof p.zipLevel === 'number' && p.zipLevel >= 0 && p.zipLevel <= 9 ? Math.floor(p.zipLevel) : 6,
    imageFormat:
      p.imageFormat === 'jpeg' || p.imageFormat === 'webp' ? p.imageFormat : 'png',
    imageQuality:
      typeof p.imageQuality === 'number' && p.imageQuality >= 50 && p.imageQuality <= 100
        ? Math.round(p.imageQuality)
        : 90,
    slideshowSec:
      typeof p.slideshowSec === 'number' && p.slideshowSec >= 1 && p.slideshowSec <= 60
        ? Math.round(p.slideshowSec)
        : 3,
    galleryLoop: p.galleryLoop !== false,
    previewMaxKB:
      typeof p.previewMaxKB === 'number' && p.previewMaxKB >= 16 && p.previewMaxKB <= 8192
        ? Math.round(p.previewMaxKB)
        : 200,
    layouts: normalLayouts(p.layouts),
    filters: normalFilters(p.filters),
    fileTypes: normalFileTypes(p.fileTypes),
    searchRoots: Array.isArray(p.searchRoots)
      ? p.searchRoots.filter((r) => typeof r === 'string' && r.startsWith('/'))
      : [],
    searchExclude: Array.isArray(p.searchExclude)
      ? p.searchExclude.filter((r) => typeof r === 'string' && r.trim())
      : DEFAULTS.searchExclude,
    paneTree: p.paneTree === true,
    scripts: normalScripts(p.scripts),
    transferSkipExisting: p.transferSkipExisting === true,
    transferNewerOnly: p.transferNewerOnly === true,
    speedLimitKB:
      typeof p.speedLimitKB === 'number' && p.speedLimitKB > 0 && p.speedLimitKB < 10_000_000
        ? Math.floor(p.speedLimitKB)
        : 0,
    confirmDelete: p.confirmDelete !== false,
    trashByDefault: p.trashByDefault !== false,
    singleInstance: p.singleInstance !== false,
    hotkey: typeof p.hotkey === 'string' && p.hotkey.trim() ? p.hotkey.trim() : 'Super+E',
    hotkeyEnabled: p.hotkeyEnabled === true,
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

function normalColumns(raw: unknown, legacyShowType: unknown): ColId[] {
  const known = new Set(COLUMNS.map((c) => c.id))
  const list = Array.isArray(raw) ? raw.filter((c): c is ColId => known.has(c as ColId)) : []
  const unique = [...new Set(list)]
  if (unique.length) return unique
  // old state files only had showTypeColumn
  return legacyShowType === false ? ['size', 'date'] : ['type', 'size', 'date']
}
