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
  /** unix mode bits, owner, hard links — filled by list() */
  mode?: number
  uid?: number
  gid?: number
  nlink?: number
  /** image pixel size, only when the caller asked for it */
  w?: number
  h?: number
  /** a folder marked «don't list me» in its own .mfm.json (shown only with hidden files) */
  hidden?: boolean
  /** the entry is a symbolic link (the path itself, not its target) */
  link?: boolean
}
export type DirRef = { name: string; path: string }
export type Listing = { path: string; parent: string | null; entries: Entry[] }
export type Result = { done: number; errors: string[] }
