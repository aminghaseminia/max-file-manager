/**
 * The paths of the drag that started inside this window.
 *
 * Wayland can deliver `dragenter`/`dragover` with the custom MIME type and still hand an empty
 * `DataTransfer` to `drop`, so the sidebar keeps this in-memory copy for the drop callback.
 * It is cleared on `dragend`/`drop`, which always follow the drag.
 */
let paths: string[] = []
let keptAt = 0
let clearTimer: ReturnType<typeof setTimeout> | null = null

export const keepDragPaths = (next: string[]): void => {
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
  paths = next
  keptAt = Date.now()
}

export const lastDragPaths = (): string[] => {
  // a native drag may never fire `dragend`; an old path list must not fake an internal drop
  if (paths.length && Date.now() - keptAt > 60_000) {
    paths = []
    return []
  }
  return paths
}

export const clearDragPaths = (): void => {
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = setTimeout(() => {
    paths = []
    clearTimer = null
  }, 300)
}

