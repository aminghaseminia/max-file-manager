export type Entry = {
  name: string
  path: string
  dir: boolean
  size: number
  mtime: number
  ext: string
  /** duplicate group number, only set by findDupes */
  group?: number
  /** per-folder look from the folder's own .mfm.json */
  color?: string
  icon?: string
}
export type DirRef = { name: string; path: string }
export type Listing = { path: string; parent: string | null; entries: Entry[] }
export type Result = { done: number; errors: string[] }
