export type Entry = { name: string; path: string; dir: boolean; size: number; mtime: number; ext: string }
export type Listing = { path: string; parent: string | null; entries: Entry[] }
export type DirRef = { name: string; path: string }
export type OpKind = 'copy' | 'move' | 'trash' | 'delete' | 'mkdir' | 'rename'
export type OpResult = { done: number; errors: string[] }
export type SizeResult = { bytes: number; files: number; capped: boolean }

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
  op(kind: OpKind, paths: string[], dest?: string, name?: string): Promise<OpResult>
  open(p: string): Promise<string>
  state: { get(): Promise<StoredState | null>; set(s: StoredState): Promise<boolean> }
}

declare global {
  interface Window {
    api: Api
  }
}

export const api = window.api
