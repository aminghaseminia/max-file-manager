import { api } from './api'

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

/**
 * The drag that main started with `wc.startDrag` (macOS/Windows).
 *
 * Those platforms cancel Chromium's own drag, so `dragend` fires at once and `clearDragPaths()`
 * wipes the list above — but the real OS drag keeps running for as long as the user holds the
 * mouse, and the drop still arrives with no custom payload. This record lives until the drop
 * consumes it; the timestamp only guards against a drag that was cancelled with Esc.
 */
let outPaths: string[] = []
let outAt = 0

export const holdDragOut = (next: string[]): void => {
  outPaths = next
  outAt = Date.now()
}

export const dragOutPaths = (): string[] => {
  if (outPaths.length && Date.now() - outAt > 60_000) {
    outPaths = []
    return []
  }
  return outPaths
}

export const releaseDragOut = (): void => {
  outPaths = []
}

/** `file://` URI → path, the shape external file managers put on the drag. */
export const fileUrlToPath = (uri: string): string => {
  try {
    const url = new URL(uri)
    if (url.protocol !== 'file:') return ''
    const p = decodeURIComponent(url.pathname)
    return /^\/[A-Za-z]:/.test(p) ? p.slice(1) : p
  } catch {
    return ''
  }
}

/**
 * Our own payload, or the `Files`/`uri-list` an external file manager sends. The in-memory copies
 * are the last resort, because a Wayland drop can arrive with an empty `DataTransfer`.
 */
export const pathsOf = (dt: DataTransfer): string[] => {
  const raw = dt.getData('application/x-mfm') || dt.getData('application/x-mfm-mark')
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        const list = parsed.filter((p): p is string => typeof p === 'string')
        if (list.length) return list
      }
    } catch {
      // fall through to the in-memory copy of our own drag
    }
  }
  // a real file list (a native drag from anywhere, including our own rows) is the most truthful
  if (dt.files?.length) {
    return [...dt.files].map((f) => api.pathForFile(f)).filter(Boolean)
  }
  const internal = lastDragPaths().length ? lastDragPaths() : dragOutPaths()
  if (internal.length) return internal
  const text = dt.getData('text/uri-list') || dt.getData('text/plain')
  if (text) {
    const list = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => (l.startsWith('file://') ? fileUrlToPath(l) : l))
      .filter(Boolean)
    if (list.length) return list
  }
  return []
}
