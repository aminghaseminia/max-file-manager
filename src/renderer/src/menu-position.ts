/**
 * Where a nested menu panel should sit. Pure so the flip can be tested: when the preferred side
 * (left in RTL, right in LTR) has no room, the panel opens on the other side of the parent item
 * instead of being clamped on top of the menu that opened it.
 */
export function submenuLeft(
  anchor: { left: number; right: number },
  width: number,
  viewportWidth: number,
  rtl: boolean,
  gap = 4,
  margin = 8
): number {
  const preferred = rtl ? anchor.left - width - gap : anchor.right + gap
  const opposite = rtl ? anchor.right + gap : anchor.left - width - gap
  const fits = (x: number): boolean => x >= margin && x + width <= viewportWidth - margin
  if (fits(preferred)) return preferred
  if (fits(opposite)) return opposite
  // neither side fits (a very narrow window): stay on the preferred side, clamped
  return Math.max(margin, Math.min(preferred, viewportWidth - width - margin))
}
