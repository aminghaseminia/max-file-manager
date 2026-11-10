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
  mode?: number
  uid?: number
  gid?: number
  nlink?: number
  w?: number
  h?: number
}
export type Listing = {
  path: string
  parent: string | null
  entries: Entry[]
  pins?: string[]
  labels?: Record<string, string>
}
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
  skipped?: number
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
  prefs?: Record<string, unknown>
  ui?: {
    sidebar: 'docked' | 'float'
    sidebarOpen: boolean
    iconDirs?: string[]
    iconTheme?: string
  }
}

export type Chrome = { customTitlebar: boolean; rounded: boolean }
export type FolderMeta = { color?: string; icon?: string }
export type PreviewKind = 'dir' | 'text' | 'image' | 'audio' | 'video' | 'binary'
export type Preview = {
  kind: PreviewKind
  size: number
  mtime: number
  text?: string
  capped?: boolean
}
export type HashResult = { path: string; hash: string | null }
export type IconRef = { name: string; path: string }
export type IconTheme = { name: string; dir: string }

export type Api = {
  list(dir: string, showHidden: boolean, dims?: boolean): Promise<Listing>
  statfs(p: string): Promise<{ free: number; size: number } | null>
  imageData(p: string): Promise<{ dataUrl?: string; error?: string }>
  saveImage(src: string, dataUrl: string, mode: 'overwrite' | 'copy'): Promise<{ path: string } | { error: string }>
  dirs(dir: string): Promise<DirRef[]>
  roots(): Promise<DirRef[]>
  home(): Promise<string>
  size(p: string): Promise<SizeResult>
  remove(paths: string[], permanent: boolean): Promise<Result>
  walk(dir: string, opts: WalkOpts): Promise<WalkResult>
  dupes(dir: string): Promise<{ entries: Entry[]; capped: boolean }>
  archive(p: string): Promise<{ entries: Entry[]; capped: boolean }>
  readText(p: string): Promise<{ text: string; size: number } | { error: string }>
  writeText(path: string, text: string): Promise<{ ok: true } | { error: string }>
  htmlToPdf(html: string, out: string, theme?: string): Promise<{ path: string } | { error: string }>
  createArchive(
    dir: string,
    name: string,
    sources: string[],
    level?: number
  ): Promise<{ path: string; files: number; bytes: number } | { error: string }>
  extract(archive: string, names: string[], dest: string): Promise<Result>
  getMeta(dir: string): Promise<FolderMeta | null>
  labelPalette(): Promise<{ id: string; name: string; color: string }[]>
  setLabel(dir: string, name: string, label: string | null): Promise<Record<string, string>>
  togglePin(dir: string, name: string, on?: boolean): Promise<string[]>
  setMeta(dir: string, meta: FolderMeta): Promise<FolderMeta | null>
  iconThemes(extra: string[]): Promise<IconTheme[]>
  iconsIn(themeDir: string): Promise<IconRef[]>
  mkdir(dir: string, name: string): Promise<Result>
  renameMany(pairs: { from: string; to: string }[]): Promise<Result>
  open(p: string): Promise<string>
  preview(p: string, maxKB?: number): Promise<Preview | null>
  hash(paths: string[], algo: string): Promise<HashResult[]>
  pathForFile(file: File): string
  jobs: {
    start(
      kind: JobKind,
      sources: string[],
      dest: string,
      opts?: { skipExisting?: boolean; newerOnly?: boolean; limitBps?: number }
    ): Promise<Job>
    pause(id: string): Promise<void>
    resume(id: string): Promise<void>
    cancel(id: string): Promise<void>
    list(): Promise<Job[]>
    clear(): Promise<void>
    onUpdate(cb: (job: Job) => void): () => void
  }
  app: { onOpenPath(cb: (p: string) => void): () => void }
  undo: { run(): Promise<{ done: number; label: string }>; depth(): Promise<number> }
  window: {
    minimize(): Promise<void>
    maximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    setFullscreen(on: boolean): Promise<boolean>
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
