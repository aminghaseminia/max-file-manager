export type Entry = {
  name: string
  path: string
  dir: boolean
  size: number
  mtime: number
  ext: string
  /** duplicate group number, only set by api.dupes */
  group?: number
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
}

export type Api = {
  list(dir: string, showHidden: boolean): Promise<Listing>
  dirs(dir: string): Promise<DirRef[]>
  roots(): Promise<DirRef[]>
  home(): Promise<string>
  size(p: string): Promise<SizeResult>
  remove(paths: string[], permanent: boolean): Promise<Result>
  walk(dir: string, opts: WalkOpts): Promise<WalkResult>
  dupes(dir: string): Promise<{ entries: Entry[]; capped: boolean }>
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
  state: { get(): Promise<StoredState | null>; set(s: StoredState): Promise<boolean> }
}

declare global {
  interface Window {
    api: Api
  }
}

export const api = window.api
