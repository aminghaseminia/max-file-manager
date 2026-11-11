/**
 * The paths of the drag that started inside this window.
 *
 * Wayland can deliver `dragenter`/`dragover` with the custom MIME type and still hand an empty
 * `DataTransfer` to `drop`, so the sidebar keeps this in-memory copy for the drop callback.
 * It is cleared on `dragend`/`drop`, which always follow the drag.
 */
let paths: string[] = []
let clearTimer: ReturnType<typeof setTimeout> | null = null

export const keepDragPaths = (next: string[]): void => {
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
  paths = next
}

export const lastDragPaths = (): string[] => paths

export const clearDragPaths = (): void => {
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = setTimeout(() => {
    paths = []
    clearTimer = null
  }, 300)
}

