import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export type MenuItem =
  | { sep: true }
  | {
      id: string
      label: string
      icon?: ReactNode
      key?: string
      danger?: boolean
      disabled?: boolean
      sep?: false
    }

type Props = {
  x: number
  y: number
  items: MenuItem[]
  onPick(id: string): void
  onClose(): void
}

export function ContextMenu({ x, y, items, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

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

  // keep the menu inside the window
  const width = 236
  const height = items.length * 30 + 12
  const left = Math.min(x, window.innerWidth - width - 8)
  const top = Math.min(y, window.innerHeight - height - 8)

  return (
    <div className="ctx" ref={ref} style={{ left, top, width }} role="menu">
      {items.map((it, i) =>
        'sep' in it && it.sep ? (
          <div key={'s' + i} className="ctx-sep" />
        ) : (
          <button
            key={(it as any).id}
            className={'ctx-item' + ((it as any).danger ? ' danger' : '')}
            disabled={(it as any).disabled}
            onClick={() => {
              onPick((it as any).id)
              onClose()
            }}
          >
            <span className="ctx-icon">{(it as any).icon}</span>
            <span className="ctx-label">{(it as any).label}</span>
            {(it as any).key && <span className="ctx-key">{(it as any).key}</span>}
          </button>
        )
      )}
    </div>
  )
}
