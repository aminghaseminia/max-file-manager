import { api } from './api'

/**
 * Drag lifecycle tracing, for `MFM_DRAG_DEBUG=1` sessions only: the main side ignores the
 * call otherwise, so this stays silent for normal use.
 */
export const dragLog = (msg: string): void => {
  try {
    console.info('[drag]', msg)
    void api.debugLog(msg)
  } catch {
    // logging must never break the drag
  }
}
