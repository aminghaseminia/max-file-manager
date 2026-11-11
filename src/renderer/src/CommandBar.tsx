import { t } from './i18n.ts'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { COMMAND_BY_ID, labelOf, type CommandId } from './commands'
import { CMD_ICON } from './commandIcons'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { formatAccel } from './keys'

export type ToolbarMode = 'icon' | 'icon-text' | 'text'

type Props = {
  items: CommandId[]
  mode: ToolbarMode
  shortcuts: Record<string, string>
  onRun(id: CommandId): void
}

const MORE = 34

/**
 * The command bar. Every item is measured in an off-screen copy first, so a narrow window shows
 * a `…` button instead of silently cutting (or scrolling) the tail of the toolbar.
 */
export function CommandBar({ items, mode, shortcuts, onRun }: Props) {
  const bar = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(items.length)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const fit = () => {
    const el = bar.current
    const m = probe.current
    if (!el || !m) return
    const widths = [...m.children].map((c) => (c as HTMLElement).offsetWidth + 4)
    const avail = el.clientWidth - 20
    let total = 0
    let n = 0
    for (const w of widths) {
      if (total + w > avail - MORE) break
      total += w
      n++
    }
    setShown(n >= widths.length ? widths.length : n)
  }

  useLayoutEffect(fit)
  useEffect(() => {
    const el = bar.current
    if (!el) return
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  })

  const press = (id: CommandId) => {
    setMenu(null)
    onRun(id)
  }

  const button = (id: CommandId, hidden: boolean) => {
    const c = COMMAND_BY_ID[id]
    if (!c) return null
    return (
      <button
        key={(hidden ? 'm:' : '') + id}
        className="cmdb"
        title={`${labelOf(c)} (${formatAccel(shortcuts[id] ?? c.key)})`}
        tabIndex={hidden ? -1 : undefined}
        onClick={() => press(id)}
      >
        {CMD_ICON[id]}
        <span>{labelOf(c)}</span>
      </button>
    )
  }

  const rest = items.slice(shown)
  const overflow: MenuItem[] = rest
    .map((id) => COMMAND_BY_ID[id])
    .filter(Boolean)
    .map((c) => ({
      id: c.id,
      label: labelOf(c),
      key: formatAccel(shortcuts[c.id] ?? c.key),
      icon: CMD_ICON[c.id]
    }))

  return (
    <>
      <div className={'cmdbar mode-' + mode} ref={bar}>
        {items.slice(0, shown).map((id) => button(id, false))}
        {rest.length > 0 && (
          <button
            className="cmdb more"
            title={t('بیشتر')}
            onClick={(ev) => {
              const r = ev.currentTarget.getBoundingClientRect()
              setMenu({ x: r.left, y: r.bottom + 2 })
            }}
          >
            <span>⋯</span>
          </button>
        )}
        <div className={'cmdbar-probe mode-' + mode} ref={probe} aria-hidden>
          {items.map((id) => button(id, true))}
        </div>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={overflow}
          onPick={(id) => press(id as CommandId)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}
