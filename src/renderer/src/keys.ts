/**
 * Accelerators are stored as text ("F5", "Ctrl+Shift+F", "Space") so they can live in prefs
 * and be edited by the user. Everything here is pure and unit tested.
 */
export type Accel = { ctrl: boolean; shift: boolean; alt: boolean; key: string }

const NAMED: Record<string, string> = {
  space: 'Space',
  escape: 'Escape',
  esc: 'Escape',
  delete: 'Delete',
  del: 'Delete',
  backspace: 'Backspace',
  enter: 'Enter',
  tab: 'Tab',
  home: 'Home',
  end: 'End',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight'
}

export function parseAccel(accel: string): Accel {
  const parts = accel.split('+').map((p) => p.trim())
  const acc: Accel = { ctrl: false, shift: false, alt: false, key: '' }
  for (const raw of parts) {
    const p = raw.toLowerCase()
    if (p === 'ctrl' || p === 'cmd' || p === 'meta') acc.ctrl = true
    else if (p === 'shift') acc.shift = true
    else if (p === 'alt') acc.alt = true
    else if (p) acc.key = raw.length === 1 ? raw.toUpperCase() : (NAMED[p] ?? raw)
  }
  return acc
}

const keyOf = (ev: KeyboardEvent): string => {
  if (ev.key === ' ') return 'Space'
  if (ev.key.length === 1) return ev.key.toUpperCase()
  return NAMED[ev.key.toLowerCase()] ?? ev.key
}

export function matchAccel(accel: string, ev: KeyboardEvent): boolean {
  if (!accel) return false
  const a = parseAccel(accel)
  if (!a.key) return false
  if (a.ctrl !== Boolean(ev.ctrlKey || ev.metaKey)) return false
  if (a.shift !== Boolean(ev.shiftKey)) return false
  if (a.alt !== Boolean(ev.altKey)) return false
  return keyOf(ev) === a.key
}

/** The capture UI uses this: a keydown becomes the accelerator string to store. */
export function accelFromEvent(ev: KeyboardEvent): string | null {
  const k = keyOf(ev)
  if (!k || ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Dead'].includes(k)) return null
  const bits: string[] = []
  if (ev.ctrlKey || ev.metaKey) bits.push('Ctrl')
  if (ev.altKey) bits.push('Alt')
  if (ev.shiftKey) bits.push('Shift')
  bits.push(k)
  return bits.join('+')
}

/** Display form for the UI: Persian-friendly separators, Latin keys. */
export function formatAccel(accel: string): string {
  const a = parseAccel(accel)
  const bits: string[] = []
  if (a.ctrl) bits.push('Ctrl')
  if (a.alt) bits.push('Alt')
  if (a.shift) bits.push('Shift')
  if (a.key) bits.push(a.key === 'Space' ? 'Space' : a.key)
  return bits.join(' + ')
}

/** Ids whose accelerator is used more than once. */
export function findConflicts(map: Record<string, string>): string[] {
  const seen = new Map<string, string[]>()
  for (const [id, accel] of Object.entries(map)) {
    if (!accel) continue
    const norm = parseAccel(accel)
    const k = `${norm.ctrl}|${norm.alt}|${norm.shift}|${norm.key}`
    seen.set(k, [...(seen.get(k) ?? []), id])
  }
  const out: string[] = []
  for (const ids of seen.values()) if (ids.length > 1) out.push(...ids)
  return out
}
