import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { submenuLeft } from './menu-position.ts'

export type MenuItem =
  | { sep: true }
  | { head: true; label: string }
  | {
      id: string
      label: string
      icon?: ReactNode
      key?: string
      danger?: boolean
      disabled?: boolean
      /** a toggle item: a check mark in the icon slot */
      checked?: boolean
      /** a grouped item: hovering (or clicking) opens a nested panel */
      children?: MenuItem[]
      sep?: false
    }

export type MenuAction = {
  id: string
  label: string
  icon: ReactNode
  disabled?: boolean
  danger?: boolean
}

type Props = {
  x: number
  y: number
  items: MenuItem[]
  /** icon-only quick actions pinned under the list (cut/copy/paste/delete) */
  actions?: MenuAction[]
  /** folder-colour dots under the quick actions; click applies the colour ('' clears it) */
  swatches?: { value: string; label: string; active?: boolean }[]
  onSwatch?(value: string): void
  onPick(id: string): void
  onClose(): void
}

function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7" />
    </svg>
  )
}

/** Keep a panel inside the content area, below the header and above the window edge. */
function clampPanel(el: HTMLElement, x: number, y: number): void {
  const bodyTop = document.querySelector('.app .body')?.getBoundingClientRect().top ?? 8
  const minTop = Math.max(8, Math.round(bodyTop + 4))
  const maxHeight = Math.max(120, window.innerHeight - minTop - 8)
  el.style.maxHeight = `${maxHeight}px`
  const height = Math.min(el.scrollHeight, maxHeight)
  el.style.top = `${Math.max(minTop, Math.min(y, window.innerHeight - height - 8))}px`
  el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8))}px`
}

export function ContextMenu({ x, y, items, actions, swatches, onSwatch, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const nestedRef = useRef<HTMLDivElement>(null)
  const [sub, setSub] = useState<{
    key: string
    items: MenuItem[]
    /** the parent row's box, so the panel can pick a side that actually has room */
    anchor: { left: number; right: number; top: number }
  } | null>(null)
  const closeTimer = useRef<number | null>(null)

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  /** Moving to the nested panel must not close it, so closing waits for a beat. */
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setSub(null), 160)
  }

  useEffect(() => () => cancelClose(), [])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  useLayoutEffect(() => {
    if (ref.current) clampPanel(ref.current, x, y)
  }, [x, y, items.length, actions?.length, swatches?.length])

  useLayoutEffect(() => {
    const el = nestedRef.current
    if (!el || !sub) return
    const rtl = document.documentElement.dir === 'rtl'
    const left = submenuLeft(sub.anchor, el.offsetWidth, window.innerWidth, rtl)
    clampPanel(el, left, sub.anchor.top - 4)
  }, [sub])

  const openSub = (ev: React.MouseEvent, child: MenuItem[], key: string) => {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
    setSub({ key, items: child, anchor: { left: rect.left, right: rect.right, top: rect.top } })
  }

  const rows = (list: MenuItem[], inSub = false) =>
    list.map((it, i) => {
      if ('sep' in it && it.sep) return <div key={'s' + i} className="ctx-sep" />
      if ('head' in it && it.head) return <div key={'h' + i} className="ctx-head">{it.label}</div>
      const item = it as Extract<MenuItem, { id: string }>
      const child = item.children
      return (
        <button
          key={item.id + i}
          className={
            'ctx-item' +
            (item.danger ? ' danger' : '') +
            (child && sub?.key === item.id ? ' is-open' : '')
          }
          disabled={item.disabled}
          onMouseEnter={(ev) => {
            cancelClose()
            if (child) openSub(ev, child, item.id)
            // hovering a plain row of the root closes an open submenu, but never itself
            else if (sub && !inSub) setSub(null)
          }}
          onClick={(ev) => {
            if (child) {
              openSub(ev, child, item.id)
              return
            }
            onPick(item.id)
            onClose()
          }}
        >
          <span className="ctx-icon">{item.checked ? <CheckMark /> : item.icon}</span>
          <span className="ctx-label">{item.label}</span>
          {child ? (
            <span className="ctx-caret" aria-hidden="true">
              {document.documentElement.dir === 'rtl' ? '‹' : '›'}
            </span>
          ) : null}
          {!child && item.key && <span className="ctx-key">{item.key}</span>}
        </button>
      )
    })

  return (
    <div
      className="ctx"
      ref={ref}
      style={{ left: x, top: y, minWidth: 248, maxWidth: 'min(440px, 92vw)', maxHeight: 'calc(100vh - 16px)' }}
      role="menu"
      tabIndex={-1}
      onMouseLeave={scheduleClose}
    >
      {rows(items)}
      {actions && actions.length > 0 && (
        <>
          <div className="ctx-sep" />
          <div className="ctx-quick">
            {actions.map((a) => (
              <button
                key={a.id}
                className={'ctx-quick-btn' + (a.danger ? ' danger' : '')}
                title={a.label}
                aria-label={a.label}
                disabled={a.disabled}
                onClick={() => {
                  onPick(a.id)
                  onClose()
                }}
              >
                {a.icon}
              </button>
            ))}
          </div>
        </>
      )}
      {swatches && swatches.length > 0 && (
        <div className="ctx-colors">
          {swatches.map((s) => (
            <button
              key={s.value || 'none'}
              className={
                'ctx-color' + (s.value ? '' : ' none') + (s.active ? ' on' : '')
              }
              style={s.value ? { background: s.value } : undefined}
              title={s.label}
              aria-label={s.label}
              onClick={() => {
                onSwatch?.(s.value)
                onClose()
              }}
            >
              {s.value ? '' : '×'}
            </button>
          ))}
        </div>
      )}
      {sub && (
        <div
          className="ctx ctx-nested"
          ref={nestedRef}
          role="menu"
          style={{ left: sub.anchor.left, top: sub.anchor.top, minWidth: 248, maxWidth: 'min(440px, 92vw)' }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {rows(sub.items, true)}
        </div>
      )}
    </div>
  )
}
