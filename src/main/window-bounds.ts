/**
 * Where a saved window rectangle belongs on the displays that exist *now*.
 *
 * Kept free of Electron so `node --test` can cover the off-screen case: a monitor
 * that was unplugged must not leave the window parked outside every work area.
 */

export type Rect = { x: number; y: number; width: number; height: number }
export type SavedBounds = Rect & { maximized?: boolean }

/** Enough of the rectangle on a work area to be grabbed and moved back. */
const MIN_VISIBLE_W = 120
const MIN_VISIBLE_H = 80

const overlap = (r: Rect, a: Rect): { w: number; h: number } => ({
  w: Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x),
  h: Math.min(r.y + r.height, a.y + a.height) - Math.max(r.y, a.y)
})

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi)

export function fitWindow(
  saved: SavedBounds | null,
  areas: Rect[],
  primary: Rect,
  defaults: { width: number; height: number; minWidth: number; minHeight: number }
): Rect {
  if (!saved) {
    return {
      x: Math.round(primary.x + (primary.width - Math.min(defaults.width, primary.width)) / 2),
      y: Math.round(primary.y + (primary.height - Math.min(defaults.height, primary.height)) / 2),
      width: Math.min(defaults.width, primary.width),
      height: Math.min(defaults.height, primary.height)
    }
  }

  const visible = areas.find((a) => {
    const o = overlap(saved, a)
    return o.w >= MIN_VISIBLE_W && o.h >= MIN_VISIBLE_H
  })
  const area = visible ?? primary
  const width = clamp(saved.width, defaults.minWidth, area.width)
  const height = clamp(saved.height, defaults.minHeight, area.height)
  // a display that no longer exists: keep the size, land centred on the main screen
  const x = visible ? clamp(saved.x, area.x, area.x + area.width - width) : area.x + (area.width - width) / 2
  const y = visible ? clamp(saved.y, area.y, area.y + area.height - height) : area.y + (area.height - height) / 2
  return { x: Math.round(x), y: Math.round(y), width, height }
}
