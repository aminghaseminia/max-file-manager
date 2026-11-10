export type Entry = {
  name: string
  path: string
  dir: boolean
  size: number
  mtime: number
  ext: string
  /** duplicate group number, only set by findDupes */
  group?: number
}
export type DirRef = { name: string; path: string }
export type Listing = { path: string; parent: string | null; entries: Entry[] }
export type Result = { done: number; errors: string[] }
