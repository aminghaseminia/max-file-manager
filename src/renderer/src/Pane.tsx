import { useEffect, useMemo, useRef, useState } from 'react'
import type { Listing } from './api'
import {
  crumbs,
  fmtDate,
  fmtSize,
  isImage,
  mediaUrl,
  orderEntries,
  typeLabel,
  type SortKey
} from './format'
import {
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  FolderPlusIcon,
  GaugeIcon,
  MoveIcon,
  PlusIcon,
  RefreshIcon,
  RenameIcon,
  SearchIcon,
  StarIcon,
  TrashIcon,
  TypeIcon,
  XIcon
} from './Icons'

export type View = 'list' | 'grid'

export type PaneState = {
  tabs: string[]
  ti: number
  hist: string[]
  hi: number
  sel: string[]
  filter: string
  listing: Listing | null
  error: string
  loading: boolean
}

type Props = {
  index: number
  pane: PaneState
  active: boolean
  sort: { key: SortKey; asc: boolean }
  view: View
  sizes: Record<string, string>
  marked: boolean
  filterRef(el: HTMLInputElement | null): void
  onActivate(): void
  onSort(key: SortKey): void
  onNav(dir: string): void
  onBack(): void
  onForward(): void
  onUp(): void
  onRefresh(): void
  onOpen(path: string): void
  onSel(paths: string[]): void
  onFilter(q: string): void
  onTabNew(): void
  onTabClose(idx: number): void
  onTabPick(idx: number): void
  onOp(kind: 'copy' | 'move' | 'trash' | 'mkdir' | 'rename'): void
  onSize(): void
  onBookmark(): void
}

const ROW = 28
const TILE_W = 108
const TILE_H = 112

export function Pane(props: Props) {
  const { pane, sort, active, view } = props
  const [scrollTop, setScrollTop] = useState(0)
  const [box, setBox] = useState({ w: 600, h: 600 })
  const listRef = useRef<HTMLDivElement>(null)
  const anchor = useRef(0)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const entries = useMemo(
    () => orderEntries(pane.listing?.entries ?? [], sort.key, sort.asc, pane.filter),
    [pane.listing, pane.filter, sort]
  )

  const cur = pane.tabs[pane.ti]
  const cols = Math.max(1, Math.floor(box.w / TILE_W))

  // windowing: only the visible slice is mounted, so 100k-entry folders stay cheap
  const start = view === 'list'
    ? Math.max(0, Math.floor(scrollTop / ROW) - 8)
    : Math.max(0, Math.floor(scrollTop / TILE_H) - 2) * cols
  const end = view === 'list'
    ? Math.min(entries.length, Math.ceil((scrollTop + box.h) / ROW) + 8)
    : Math.min(entries.length, (Math.ceil((scrollTop + box.h) / TILE_H) + 2) * cols)

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

  const sortMark = (k: SortKey) => (sort.key === k ? (sort.asc ? ' ▲' : ' ▼') : '')

  return (
    <section className={'pane' + (active ? ' active' : '')} onMouseDown={props.onActivate}>
      <div className="tabs">
        <span className={'badge' + (active ? ' on' : '')}>{props.index === 0 ? 'مبدأ' : 'مقصد'}</span>
        {pane.tabs.map((t, i) => (
          <div key={i} className={'tab' + (i === pane.ti ? ' on' : '')} onClick={() => props.onTabPick(i)}>
            <span dir="auto">{t.split(/[\\/]/).filter(Boolean).pop() || t}</span>
            {pane.tabs.length > 1 && (
              <button
                className="x"
                title="بستن تب"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onTabClose(i)
                }}
              >
                <XIcon size={11} />
              </button>
            )}
          </div>
        ))}
        <button className="tb" title="تب نو" onClick={props.onTabNew}>
          <PlusIcon size={13} />
        </button>
      </div>

      <div className="path">
        <div className="crumbs">
          {crumbs(cur).map((c) => (
            <span key={c.path} className="crumb-wrap">
              <button className="crumb" dir="auto" title={c.path} onClick={() => props.onNav(c.path)}>
                {c.name}
              </button>
              <ChevronLeftIcon size={11} />
            </span>
          ))}
        </div>
        <span className="spacer" />
        <label className="filter">
          <SearchIcon />
          <input
            ref={props.filterRef}
            dir="auto"
            placeholder="فیلتر نام"
            value={pane.filter}
            onChange={(e) => props.onFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                props.onFilter('')
                e.currentTarget.blur()
              }
              if (e.key === 'Enter' && entries[0]) props.onOpen(entries[0].path)
            }}
          />
        </label>
      </div>

      <div className="actions">
        <button className="tb" title="بازگشت (Alt+←)" onClick={props.onBack}>
          <ChevronRightIcon />
        </button>
        <button className="tb" title="جلو (Alt+→)" onClick={props.onForward}>
          <ChevronLeftIcon />
        </button>
        <button className="tb" title="بالا (Backspace)" onClick={props.onUp}>
          <ArrowUpIcon />
        </button>
        <button className="tb" title="نوسازی (F3)" onClick={props.onRefresh}>
          <RefreshIcon />
        </button>
        <span className="divider" />
        <button className="tb" title="کپی (F5)" onClick={() => props.onOp('copy')}>
          <CopyIcon />
        </button>
        <button className="tb" title="انتقال (F6)" onClick={() => props.onOp('move')}>
          <MoveIcon />
        </button>
        <button className="tb" title="تغییر نام (F2)" onClick={() => props.onOp('rename')}>
          <RenameIcon />
        </button>
        <button className="tb" title="پوشهٔ نو (F7)" onClick={() => props.onOp('mkdir')}>
          <FolderPlusIcon />
        </button>
        <button className="tb" title="سطل بازیافت (F8)" onClick={() => props.onOp('trash')}>
          <TrashIcon />
        </button>
        <button className="tb" title="اندازهٔ پوشه (F9)" onClick={props.onSize}>
          <GaugeIcon />
        </button>
        <span className="spacer" />
        <button
          className={'tb' + (props.marked ? ' on' : '')}
          title="نشان‌کردن این پوشه (Ctrl+D)"
          onClick={props.onBookmark}
        >
          <StarIcon filled={props.marked} />
        </button>
      </div>

      {view === 'list' && (
        <div className="head">
          <button className="col" onClick={() => props.onSort('name')}>
            نام{sortMark('name')}
          </button>
          <button className="col" onClick={() => props.onSort('ext')}>
            نوع{sortMark('ext')}
          </button>
          <button className="col num" onClick={() => props.onSort('size')}>
            اندازه{sortMark('size')}
          </button>
          <button className="col" onClick={() => props.onSort('mtime')}>
            تاریخ{sortMark('mtime')}
          </button>
        </div>
      )}

      <div className="rows" ref={listRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {pane.error ? (
          <div className="error">{pane.error}</div>
        ) : entries.length === 0 ? (
          <div className="empty">{pane.loading ? 'در حال خواندن…' : pane.filter ? 'چیزی با این نام نیست' : 'پوشه خالی است'}</div>
        ) : view === 'list' ? (
          <div style={{ height: entries.length * ROW, position: 'relative' }}>
            {entries.slice(start, end).map((e, k) => (
              <div
                key={e.path}
                className={'row' + (pane.sel.includes(e.path) ? ' on' : '')}
                style={{ top: (start + k) * ROW }}
                title={e.name}
                onClick={(ev) => click(start + k, ev)}
                onDoubleClick={() => props.onOpen(e.path)}
              >
                <span className="name">
                  <TypeIcon entry={e} />
                  <span dir="auto" className="trunc">{e.name}</span>
                </span>
                <span className="kind">{typeLabel(e)}</span>
                <span className="num">{props.sizes[e.path] ?? fmtSize(e.size, e.dir)}</span>
                <span className="dim">{fmtDate(e.mtime)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ height: Math.ceil(entries.length / cols) * TILE_H, position: 'relative' }}>
            {entries.slice(start, end).map((e, k) => {
              const idx = start + k
              const r = Math.floor(idx / cols)
              const c = idx % cols
              return (
                <div
                  key={e.path}
                  className={'tile' + (pane.sel.includes(e.path) ? ' on' : '')}
                  style={{ top: r * TILE_H, insetInlineStart: c * TILE_W, width: TILE_W - 6 }}
                  onClick={(ev) => click(idx, ev)}
                  onDoubleClick={() => props.onOpen(e.path)}
                  title={e.name}
                >
                  <span className="thumb">
                    {!e.dir && isImage(e.ext) && e.size < 8_000_000 ? (
                      <img src={mediaUrl(e.path)} alt="" loading="lazy" draggable={false} />
                    ) : (
                      <TypeIcon entry={e} size={34} />
                    )}
                  </span>
                  <span className="tile-name" dir="auto">{e.name}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
