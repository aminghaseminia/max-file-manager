import { t } from './i18n.ts'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { COMMAND_BY_ID, GROUP_ORDER, groupLabelOf, labelOf, type CommandGroup, type CommandId } from './commands'
import { CMD_ICON } from './commandIcons'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { formatAccel } from './keys'

export type ToolbarMode = 'icon' | 'icon-text' | 'text'

type Props = {
  items: CommandId[]
  mode: ToolbarMode
  /** `office` draws the grouped ribbon; `compact` keeps the single measured row */
  variant?: 'compact' | 'office'
  shortcuts: Record<string, string>
  /** commands that exist but do not apply to what the active pane shows (e.g. a remote folder) */
  disabled?: CommandId[]
  /** no horizontal row: render only the header's ⋮ button and its all-commands menu */
  collapsed?: boolean
  onRun(id: CommandId, anchor?: { x: number; y: number }): void
}

const MORE = 34

/**
 * The command bar. Every item is measured in an off-screen copy first, so a narrow window shows
 * a `…` button instead of silently cutting (or scrolling) the tail of the toolbar.
 */
export function CommandBar({ items, mode, variant = 'compact', shortcuts, disabled = [], collapsed, onRun }: Props) {
  const ribbon = variant === 'office'
  const bar = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(items.length)
  const [shownGroups, setShownGroups] = useState(99)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  /** The ribbon keeps whole groups together, in the same order the settings page lists them. */
  const groups = useMemo(() => {
    const by = new Map<CommandGroup, CommandId[]>()
    for (const id of items) {
      const def = COMMAND_BY_ID[id]
      if (!def) continue
      const list = by.get(def.group)
      if (list) list.push(id)
      else by.set(def.group, [id])
    }
    return GROUP_ORDER.filter((g) => by.has(g)).map((g) => ({ id: g, items: by.get(g)! }))
  }, [items])

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

  const fitRibbon = () => {
    const el = bar.current
    const m = probe.current
    if (!el || !m) return
    const avail = el.clientWidth - 12 - MORE
    let total = 0
    let n = 0
    for (const child of [...m.children] as HTMLElement[]) {
      const w = child.offsetWidth
      if (total + w > avail) break
      total += w
      n++
    }
    setShownGroups(n)
  }

  useLayoutEffect(() => {
    if (ribbon) fitRibbon()
    else fit()
  })
  useEffect(() => {
    const el = bar.current
    if (!el) return
    const ro = new ResizeObserver(() => (ribbon ? fitRibbon() : fit()))
    ro.observe(el)
    return () => ro.disconnect()
  })

  const press = (id: CommandId, anchor?: { x: number; y: number }) => {
    setMenu(null)
    onRun(id, anchor)
  }

  const menuItems = (list: CommandId[]): MenuItem[] =>
    list
      .map((id) => COMMAND_BY_ID[id])
      .filter(Boolean)
      .map((c) => ({
        id: c.id,
        label: labelOf(c),
        key: formatAccel(shortcuts[c.id] ?? c.key),
        icon: CMD_ICON[c.id],
        disabled: disabled.includes(c.id)
      }))

  if (collapsed) {
    return (
      <>
        <button
          className="tb tb-more"
          title={t('همهٔ فرمان‌ها')}
          aria-label={t('همهٔ فرمان‌ها')}
          onClick={(ev) => {
            const r = ev.currentTarget.getBoundingClientRect()
            setMenu({ x: r.left, y: r.bottom + 2 })
          }}
        >
          ⋮
        </button>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menuItems(items)}
            onPick={(id) => press(id as CommandId, menu ?? undefined)}
            onClose={() => setMenu(null)}
          />
        )}
      </>
    )
  }

  const button = (id: CommandId, hidden: boolean) => {
    const c = COMMAND_BY_ID[id]
    if (!c) return null
    const off = disabled.includes(id)
    return (
      <button
        key={(hidden ? 'm:' : '') + id}
        className="cmdb"
        disabled={off}
        title={`${labelOf(c)} (${formatAccel(shortcuts[id] ?? c.key)})${off ? ' — ' + t('برای پوشهٔ دور در دسترس نیست') : ''}`}
        tabIndex={hidden ? -1 : undefined}
        onClick={(ev) => {
          const r = ev.currentTarget.getBoundingClientRect()
          press(id, { x: r.left, y: r.bottom + 2 })
        }}
      >
        {CMD_ICON[id]}
        <span>{labelOf(c)}</span>
      </button>
    )
  }

  const ribbonButton = (id: CommandId) => {
    const c = COMMAND_BY_ID[id]
    if (!c) return null
    const off = disabled.includes(id)
    return (
      <button
        key={id}
        className="rb"
        disabled={off}
        title={`${labelOf(c)} (${formatAccel(shortcuts[id] ?? c.key)})${off ? ' — ' + t('برای پوشهٔ دور در دسترس نیست') : ''}`}
        onClick={(ev) => {
          const r = ev.currentTarget.getBoundingClientRect()
          press(id, { x: r.left, y: r.bottom + 2 })
        }}
      >
        {CMD_ICON[id]}
        <span className="rb-label">{t(c.short ?? c.label)}</span>
      </button>
    )
  }

  const group = (g: { id: CommandGroup; items: CommandId[] }, probeCopy = false) => (
    <section className="rb-group" key={(probeCopy ? 'p:' : '') + g.id}>
      <div className="rb-row">{g.items.map(ribbonButton)}</div>
      <div className="rb-group-label">{groupLabelOf(g.id)}</div>
    </section>
  )

  if (ribbon) {
    const hidden = groups.slice(shownGroups).flatMap((g) => g.items)
    return (
      <>
        <div className="cmdbar ribbon" ref={bar}>
          {groups.slice(0, shownGroups).map((g) => group(g))}
          {hidden.length > 0 && (
            <button
              className="rb rb-more"
              title={t('بیشتر')}
              onClick={(ev) => {
                const r = ev.currentTarget.getBoundingClientRect()
                setMenu({ x: r.left, y: r.bottom + 2 })
              }}
            >
              ⋯
            </button>
          )}
          <div className="cmdbar-probe ribbon" ref={probe} aria-hidden>
            {groups.map((g) => group(g, true))}
          </div>
        </div>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menuItems(hidden)}
            onPick={(id) => press(id as CommandId, menu ?? undefined)}
            onClose={() => setMenu(null)}
          />
        )}
      </>
    )
  }

  const rest = items.slice(shown)
  const overflow: MenuItem[] = menuItems(rest)

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
          onPick={(id) => press(id as CommandId, menu ?? undefined)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}
