import { useEffect, useMemo, useRef, useState } from 'react'
import type { Entry, Listing } from './api'
import { crumbs, fmtDate, fmtSize, sortEntries, type SortKey } from './format'

export type PaneState = {
  tabs: string[]
  ti: number
  sel: string[]
  listing: Listing | null
  error: string
  loading: boolean
}

type Props = {
  index: number
  pane: PaneState
  /** sorted entries of the active pane, shared so the status bar matches this list */
  visible: Entry[] | null
  active: boolean
  sort: { key: SortKey; asc: boolean }
  onActivate(): void
  onSort(key: SortKey): void
  onNav(dir: string): void
  onUp(): void
  onRefresh(): void
  onOpen(path: string): void
  onSel(paths: string[]): void
  onTabNew(): void
  onTabClose(idx: number): void
  onTabPick(idx: number): void
}

const ROW = 26

export function Pane(props: Props) {
  const { pane, sort, active } = props
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const listRef = useRef<HTMLDivElement>(null)
  const anchor = useRef(0)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const entries = useMemo(
    () => props.visible ?? sortEntries(pane.listing?.entries ?? [], sort.key, sort.asc),
    [props.visible, pane.listing, sort]
  )

  // windowing: only the visible slice is mounted, so 100k-entry folders stay cheap
  const start = Math.max(0, Math.floor(scrollTop / ROW) - 6)
  const end = Math.min(entries.length, Math.ceil((scrollTop + height) / ROW) + 6)

  const click = (idx: number, ev: React.MouseEvent) => {
    const path = entries[idx].path
    if (ev.ctrlKey || ev.metaKey) {
      props.onSel(pane.sel.includes(path) ? pane.sel.filter((p) => p !== path) : [...pane.sel, path])
      anchor.current = idx
    } else if (ev.shiftKey) {
      const a = Math.min(anchor.current, idx)
      const b = Math.max(anchor.current, idx)
      props.onSel(entries.slice(a, b + 1).map((e) => e.path))
    } else {
      props.onSel([path])
      anchor.current = idx
    }
  }

  const cur = pane.tabs[pane.ti]

  return (
    <section
      className={'pane' + (active ? ' active' : '')}
      onMouseDown={props.onActivate}
      onFocus={props.onActivate}
    >
      <div className="tabs">
        {pane.tabs.map((t, i) => (
          <div key={i} className={'tab' + (i === pane.ti ? ' on' : '')} onClick={() => props.onTabPick(i)}>
            <span dir="auto">{t.split(/[\\/]/).filter(Boolean).pop() || t}</span>
            {pane.tabs.length > 1 && (
              <button
                className="x"
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onTabClose(i)
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button className="tb plus" title="New tab" onClick={props.onTabNew}>
          +
        </button>
        <span className="spacer" />
        <button className="tb" title="Up (Backspace)" onClick={props.onUp}>
          ↑
        </button>
        <button className="tb" title="Refresh (F3)" onClick={props.onRefresh}>
          ⟳
        </button>
      </div>

      <div className="path" dir="ltr">
        {crumbs(cur).map((c) => (
          <button key={c.path} className="crumb" dir="auto" onClick={() => props.onNav(c.path)}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="head">
        <button className="col" onClick={() => props.onSort('name')}>
          Name {sort.key === 'name' ? (sort.asc ? '▲' : '▼') : ''}
        </button>
        <button className="col num" onClick={() => props.onSort('size')}>
          Size {sort.key === 'size' ? (sort.asc ? '▲' : '▼') : ''}
        </button>
        <button className="col" onClick={() => props.onSort('mtime')}>
          Modified {sort.key === 'mtime' ? (sort.asc ? '▲' : '▼') : ''}
        </button>
      </div>

      <div className="rows" ref={listRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {pane.error ? (
          <div className="error">{pane.error}</div>
        ) : entries.length === 0 ? (
          <div className="empty">{pane.loading ? 'reading…' : 'empty folder'}</div>
        ) : (
          <div style={{ height: entries.length * ROW, position: 'relative' }}>
            {entries.slice(start, end).map((e, k) => (
              <div
                key={e.path}
                className={'row' + (pane.sel.includes(e.path) ? ' on' : '')}
                style={{ top: (start + k) * ROW }}
                onClick={(ev) => click(start + k, ev)}
                onDoubleClick={() => props.onOpen(e.path)}
              >
                <span className="name" dir="auto">
                  <span className={'ico ' + kindOf(e)} />
                  {e.name}
                </span>
                <span className="num">{fmtSize(e.size, e.dir)}</span>
                <span className="dim">{fmtDate(e.mtime)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/** Flat two-tone type marker: no emoji, no per-file icons to fetch. */
function kindOf(e: Entry): string {
  if (e.dir) return 'dir'
  if (IMAGE.has(e.ext)) return 'img'
  if (ARCHIVE.has(e.ext)) return 'zip'
  if (CODE.has(e.ext)) return 'code'
  return 'file'
}

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'])
const ARCHIVE = new Set(['zip', 'tar', 'gz', 'xz', '7z', 'rar', 'bz2', 'zst'])
const CODE = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'c', 'h', 'cpp', 'hpp', 'json', 'md', 'sh', 'css', 'html', 'yml', 'yaml', 'toml'])
