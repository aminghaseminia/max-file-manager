export type Entry = {
  name: string
  path: string
  dir: boolean
  size: number
  mtime: number
  ext: string
  /** duplicate group number, only set by api.dupes */
  group?: number
  /** per-folder look, from the folder's own .mfm.json */
  color?: string
  icon?: string
}
export type Listing = { path: string; parent: string | null; entries: Entry[] }
export type DirRef = { name: string; path: string }
export type Result = { done: number; errors: string[] }
export type SizeResult = { bytes: number; files: number; capped: boolean }

export type WalkOpts = {
  query?: string
  regex?: boolean
  content?: string
  minSize?: number
  maxSize?: number
  newerThan?: number
  limit?: number
}
export type WalkResult = { entries: Entry[]; scanned: number; capped: boolean }

export type JobKind = 'copy' | 'move'
export type JobState = 'queued' | 'running' | 'paused' | 'done' | 'cancelled' | 'error'
export type Job = {
  id: string
  kind: JobKind
  label: string
  state: JobState
  bytes: number
  done: number
  files: number
  filesDone: number
  speed: number
  current: string
  errors: string[]
}

export type StoredState = {
  panes?: { tabs: string[]; ti: number }[]
  active?: number
  hidden?: boolean
  theme?: 'dark' | 'light'
  sort?: { key: string; asc: boolean }
  view?: 'list' | 'grid'
  marks?: string[]
  chrome?: { customTitlebar: boolean; rounded: boolean }
  ui?: {
    sidebar: 'docked' | 'float'
    sidebarOpen: boolean
    iconDirs?: string[]
    iconTheme?: string
  }
}

export type Chrome = { customTitlebar: boolean; rounded: boolean }
export type FolderMeta = { color?: string; icon?: string }
export type IconRef = { name: string; path: string }
export type IconTheme = { name: string; dir: string }

export type Api = {
  list(dir: string, showHidden: boolean): Promise<Listing>
  dirs(dir: string): Promise<DirRef[]>
  roots(): Promise<DirRef[]>
  home(): Promise<string>
  size(p: string): Promise<SizeResult>
  remove(paths: string[], permanent: boolean): Promise<Result>
  walk(dir: string, opts: WalkOpts): Promise<WalkResult>
  dupes(dir: string): Promise<{ entries: Entry[]; capped: boolean }>
  archive(p: string): Promise<{ entries: Entry[]; capped: boolean }>
  extract(archive: string, names: string[], dest: string): Promise<Result>
  getMeta(dir: string): Promise<FolderMeta | null>
  setMeta(dir: string, meta: FolderMeta): Promise<FolderMeta | null>
  iconThemes(extra: string[]): Promise<IconTheme[]>
  iconsIn(themeDir: string): Promise<IconRef[]>
  mkdir(dir: string, name: string): Promise<Result>
  renameMany(pairs: { from: string; to: string }[]): Promise<Result>
  open(p: string): Promise<string>
  jobs: {
    start(kind: JobKind, sources: string[], dest: string): Promise<Job>
    pause(id: string): Promise<void>
    resume(id: string): Promise<void>
    cancel(id: string): Promise<void>
    list(): Promise<Job[]>
    clear(): Promise<void>
    onUpdate(cb: (job: Job) => void): () => void
  }
  undo: { run(): Promise<{ done: number; label: string }>; depth(): Promise<number> }
  window: {
    minimize(): Promise<void>
    maximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    getChrome(): Promise<Chrome>
    setChrome(c: Chrome): Promise<Chrome>
    onMaximized(cb: (max: boolean) => void): () => void
  }
  state: { get(): Promise<StoredState | null>; set(s: StoredState): Promise<boolean> }
}

declare global {
  interface Window {
    api: Api
  }
}

export const api = window.api
