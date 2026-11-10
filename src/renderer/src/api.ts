export type Entry = { name: string; path: string; dir: boolean; size: number; mtime: number; ext: string }
export type Listing = { path: string; parent: string | null; entries: Entry[] }
export type OpKind = 'copy' | 'move' | 'trash' | 'delete' | 'mkdir' | 'rename'
export type OpResult = { done: number; errors: string[] }

export type Api = {
  list(dir: string, showHidden: boolean): Promise<Listing>
  roots(): Promise<{ name: string; path: string }[]>
  home(): Promise<string>
  op(kind: OpKind, paths: string[], dest?: string, name?: string): Promise<OpResult>
  open(p: string): Promise<string>
}

declare global {
  interface Window {
    api: Api
  }
}

export const api = window.api
