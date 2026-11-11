import { t } from './i18n.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Entry, Listing } from './api'
import type { ColId } from './prefs'
import {
  crumbs,
  fa,
  fmtDate,
  fmtSize,
  groupLabel,
  modeString,
  isImage,
  mediaUrl,
  thumbUrl,
  orderEntries,
  typeLabel,
  type SortKey
} from './format'
import { PreviewPanel } from './PreviewPanel'
import { FolderGlyph } from './Icons'
import {
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DupeIcon,
  FolderPlusIcon,
  GaugeIcon,
  LayersIcon,
  MoveIcon,
  PaletteIcon,
  PinIcon,
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

export type Virtual = { kind: 'flat' | 'search' | 'dupes' | 'archive'; label: string }

export type PaneState = {
  tabs: string[]
  ti: number
  /** tabs before this index are pinned: first, protected from closing, no boundary crossing */
  pinCount: number
  hist: string[]
  hi: number
  sel: string[]
  filter: string
  listing: Listing | null
  /** flat view / search / duplicates / archive replace the folder listing with these */
  virtual: Virtual | null
  results: Entry[] | null
  /** archive path while virtual.kind === 'archive' */
  archive: string | null
  /** this pane shows a preview of an entry instead of a listing */
  preview: { entry: Entry; from: number } | null
  error: string
  loading: boolean
}

export type SearchQuery = { query: string; content: string; regex: boolean }

type Props = {
  index: number
  pane: PaneState
  active: boolean
  sort: { key: SortKey; asc: boolean }
  view: View
  foldersFirst: boolean
  columns: ColId[]
  sizeFormat: 'human' | 'bytes'
  dateFormat: 'iso' | 'jalali' | 'short'
  showSeconds: boolean
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
  onSel(paths: string[], mode: 'set' | 'toggle'): void
  onFilter(q: string): void
  onTabNew(): void
  onTabClose(idx: number): void
  onTabPick(idx: number): void
  onTabMenu(idx: number, x: number, y: number): void
  onTabMove(from: number, to: number): void
  middleClickClosesTab: boolean
  palette: { id: string; name: string; color: string }[]
  typeColors: Record<string, string>
  onOp(kind: 'copy' | 'move' | 'trash' | 'mkdir' | 'rename'): void
  onSize(): void
  onBookmark(): void
  onFlat(): void
  onDupes(): void
  onSearch(q: SearchQuery): void
  onExitVirtual(): void
  onFolderLook(): void
  previewIndex?: { at: number; total: number } | null
  onPreviewNav?(delta: number): void
  onPreviewClose?(): void
  onGallery?(): void
  onContext(path: string | null, x: number, y: number): void
  onDropInternal(paths: string[], dest: string, copy: boolean): void
  onDropFiles(files: File[], dest: string): void
}

const ROW = 28
const TILE_W = 108
const TILE_H = 112

const isImageName = (n: string) => /\.(png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i.test(n)

export function Pane(props: Props) {
  const { pane, sort, active, view } = props
  const [scrollTop, setScrollTop] = useState(0)
  const [box, setBox] = useState({ w: 600, h: 600 })
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [content, setContent] = useState('')
  const [regex, setRegex] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const anchor = useRef(0)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const source = pane.virtual && pane.results ? pane.results : (pane.listing?.entries ?? [])
  const pinSet = useMemo(() => new Set(pane.listing?.pins ?? []), [pane.listing?.pins])
  const labelMap = pane.listing?.labels ?? {}
  const ratingMap = pane.listing?.ratings ?? {}
  const labelColor = (name: string) =>
    props.palette.find((l) => l.id === labelMap[name])?.color ?? ''

  const entries = useMemo(
    () =>
      orderEntries(
        source,
        sort.key,
        sort.asc,
        pane.filter,
        props.foldersFirst,
        pinSet,
        labelMap,
        ratingMap
      ),
    [source, pane.filter, sort, props.foldersFirst]
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
    // toggle is resolved against the newest selection in App, so fast ctrl-clicks accumulate
    if (ev.ctrlKey || ev.metaKey) {
      props.onSel([path], 'toggle')
      anchor.current = idx
    } else if (ev.shiftKey) {
      const a = Math.min(anchor.current, idx)
      const b = Math.max(anchor.current, idx)
      props.onSel(entries.slice(a, b + 1).map((e) => e.path), 'set')
    } else {
      props.onSel([path], 'set')
      anchor.current = idx
    }
  }

  if (pane.preview) {
    return (
      <section
        className={'pane previewing' + (active ? ' active' : '')}
        onMouseDown={props.onActivate}
      >
        <PreviewPanel
          fill
          entry={pane.preview.entry}
          imageIndex={props.previewIndex ?? null}
          onNavImage={props.onPreviewNav}
          onGallery={props.onGallery}
          onOpen={props.onOpen}
          onClose={() => props.onPreviewClose?.()}
        />
      </section>
    )
  }

  const cell = (id: ColId, e: Entry): string => {
    switch (id) {
      case 'type':
        return e.group ? groupLabel(e) : typeLabel(e)
      case 'size':
        return props.sizes[e.path] ?? fmtSize(e.size, e.dir, props.sizeFormat)
      case 'date':
        return fmtDate(e.mtime, props.dateFormat, props.showSeconds)
      case 'mode':
        return e.mode != null ? modeString(e.mode) : ''
      case 'owner':
        return e.uid != null ? `${fa(e.uid)}:${fa(e.gid ?? 0)}` : ''
      case 'links':
        return e.nlink != null ? fa(e.nlink) : ''
      case 'dims':
        return e.w && e.h ? `${fa(e.w)}×${fa(e.h)}` : ''
      case 'rating': {
        const n = ratingMap[e.name] ?? 0
        return n ? '★'.repeat(n) : ''
      }
    }
  }

  const COL_META: Record<ColId, { label: string; width: number; sort?: SortKey; end?: boolean }> = {
    type: { label: t('نوع'), width: 88, sort: 'ext' },
    size: { label: t('اندازه'), width: 94, sort: 'size', end: true },
    date: { label: t('تاریخ'), width: 120, sort: 'mtime' },
    mode: { label: t('مجوز'), width: 92 },
    owner: { label: t('مالک'), width: 72, end: true },
    links: { label: t('لینک'), width: 52, end: true },
    dims: { label: t('ابعاد'), width: 90, end: true },
    rating: { label: t('امتیاز'), width: 74, end: true }
  }

  const gridTemplate =
    'minmax(0, 1fr) ' + props.columns.map((c) => `${COL_META[c].width}px`).join(' ')

  // with many columns a narrow pane has to scroll sideways instead of clipping them
  const minWidth =
    200 + props.columns.reduce((n, c) => n + COL_META[c].width + 8, 0)

  const sortMark = (k: SortKey) => (sort.key === k ? (sort.asc ? ' ▲' : ' ▼') : '')

  // rows carry their own paths (not text) so a drag between panes stays typed
  const dragPaths = (path: string) => (pane.sel.includes(path) ? pane.sel : [path])

  const startDrag = (ev: React.DragEvent, path: string) => {
    ev.dataTransfer.setData('application/x-mfm', JSON.stringify(dragPaths(path)))
    ev.dataTransfer.effectAllowed = 'copyMove'
  }

  const allowDrop = (ev: React.DragEvent) => {
    const dtTypes = ev.dataTransfer.types
    if (dtTypes.includes('application/x-mfm') || dtTypes.includes('Files')) {
      ev.preventDefault()
      ev.dataTransfer.dropEffect = ev.ctrlKey ? 'copy' : 'move'
    }
  }

  const dropOn = (ev: React.DragEvent, dest: string) => {
    ev.preventDefault()
    ev.stopPropagation()
    const raw = ev.dataTransfer.getData('application/x-mfm')
    if (raw) {
      try {
        props.onDropInternal(JSON.parse(raw) as string[], dest, ev.ctrlKey)
      } catch {
        // a foreign payload is not ours to act on
      }
      return
    }
    const files = [...ev.dataTransfer.files]
    if (files.length) props.onDropFiles(files, dest)
  }

  const menu = (ev: React.MouseEvent, path: string | null) => {
    ev.preventDefault()
    ev.stopPropagation()
    props.onContext(path, ev.clientX, ev.clientY)
  }

  const runSearch = () => {
    if (!query && !content) return
    props.onSearch({ query, content, regex })
  }

  return (
    <section
      className={'pane' + (active ? ' active' : '')}
      onMouseDown={props.onActivate}
    >
      <div className="tabs">
        <span className={'badge' + (active ? ' on' : '')}>{props.index === 0 ? t('مبدأ') : t('مقصد')}</span>
        {pane.tabs.map((tabPath, i) => {
          const pinned = i < pane.pinCount
          return (
            <div
              key={tabPath + i}
              className={'tab' + (i === pane.ti ? ' on' : '') + (pinned ? ' pinned' : '')}
              draggable
              onDragStart={(ev) => {
                ev.dataTransfer.setData('application/x-mfm-tab', String(i))
                ev.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(ev) => {
                if (ev.dataTransfer.types.includes('application/x-mfm-tab')) ev.preventDefault()
              }}
              onDrop={(ev) => {
                const raw = ev.dataTransfer.getData('application/x-mfm-tab')
                if (!raw) return
                ev.preventDefault()
                ev.stopPropagation()
                props.onTabMove(Number(raw), i)
              }}
              onClick={() => props.onTabPick(i)}
              onAuxClick={(ev) => {
                if (ev.button === 1 && props.middleClickClosesTab) {
                  ev.preventDefault()
                  props.onTabClose(i)
                }
              }}
              onContextMenu={(ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                props.onTabMenu(i, ev.clientX, ev.clientY)
              }}
              title={tabPath}
            >
              {pinned && <PinIcon filled />}
              <span dir="auto">{tabPath.split(/[\\/]/).filter(Boolean).pop() || tabPath}</span>
              {!pinned && pane.tabs.length > 1 && (
                <button
                  className="x"
                  title={t(t('بستن تب'))}
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onTabClose(i)
                  }}
                >
                  <XIcon size={11} />
                </button>
              )}
            </div>
          )
        })}
        <button className="tb" title={t(t('تب نو (Ctrl+T)'))} onClick={props.onTabNew}>
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
        {pane.virtual && (
          <span className="vchip">
            {pane.virtual.label}
            <button className="x" title={t(t('بازگشت به پوشه'))} onClick={props.onExitVirtual}>
              <XIcon size={11} />
            </button>
          </span>
        )}
        <span className="spacer" />
        <label className="filter">
          <SearchIcon />
          <input
            ref={props.filterRef}
            dir="auto"
            placeholder={t(t('فیلتر نام'))}
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
        <button className="tb" title={t(t('بازگشت (Alt+←)'))} onClick={props.onBack}>
          <ChevronRightIcon />
        </button>
        <button className="tb" title={t(t('جلو (Alt+→)'))} onClick={props.onForward}>
          <ChevronLeftIcon />
        </button>
        <button className="tb" title={t(t('بالا (Backspace)'))} onClick={props.onUp}>
          <ArrowUpIcon />
        </button>
        <button className="tb" title={t(t('نوسازی (Ctrl+R)'))} onClick={props.onRefresh}>
          <RefreshIcon />
        </button>
        <span className="divider" />
        <button className="tb" title={t(t('کپی (F5)'))} onClick={() => props.onOp('copy')}>
          <CopyIcon />
        </button>
        <button className="tb" title={t(t('انتقال (F6)'))} onClick={() => props.onOp('move')}>
          <MoveIcon />
        </button>
        <button className="tb" title={t(t('تغییر نام (F2)'))} onClick={() => props.onOp('rename')}>
          <RenameIcon />
        </button>
        <button className="tb" title={t(t('پوشهٔ نو (F7)'))} onClick={() => props.onOp('mkdir')}>
          <FolderPlusIcon />
        </button>
        <button className="tb" title={t(t('سطل بازیافت (F8)'))} onClick={() => props.onOp('trash')}>
          <TrashIcon />
        </button>
        <span className="divider" />
        <button className="tb" title={t(t('اندازهٔ پوشه (F9)'))} onClick={props.onSize}>
          <GaugeIcon />
        </button>
        <button className="tb" title={t(t('رنگ و آیکون پوشه'))} onClick={props.onFolderLook}>
          <PaletteIcon />
        </button>
        <button
          className={'tb' + (pane.virtual?.kind === 'flat' ? ' on' : '')}
          title={t(t('نمای تخت (Ctrl+Shift+F)'))}
          onClick={props.onFlat}
        >
          <LayersIcon />
        </button>
        <button
          className={'tb' + (pane.virtual?.kind === 'dupes' ? ' on' : '')}
          title={t(t('یافتن فایل‌های تکراری'))}
          onClick={props.onDupes}
        >
          <DupeIcon />
        </button>
        <button
          className={'tb' + (searchOpen ? ' on' : '')}
          title={t(t('جست‌وجو (Ctrl+Shift+S)'))}
          onClick={() => setSearchOpen((o) => !o)}
        >
          <SearchIcon />
        </button>
        <span className="spacer" />
        <button
          className={'tb' + (props.marked ? ' on' : '')}
          title={t(t('نشان‌کردن این پوشه (Ctrl+D)'))}
          onClick={props.onBookmark}
        >
          <StarIcon filled={props.marked} />
        </button>
      </div>

      {searchOpen && (
        <div className="searchbar">
          <label className="filter grow">
            <SearchIcon />
            <input
              dir="auto"
              placeholder={t(t('نام (* و ? مجاز)'))}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
          </label>
          <label className="filter grow">
            <input
              dir="auto"
              placeholder={t(t('داخل محتوا (متن)'))}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
          </label>
          <label className="check" title={t(t('الگوی نام را عبارت باقاعده بگیر'))}>
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
            regex
          </label>
          <button className="btn" onClick={runSearch}>
            جست‌وجو
          </button>
        </div>
      )}

      {view === 'list' && (
        <div className="headwrap" ref={headRef}>
        <div className="head" style={{ gridTemplateColumns: gridTemplate, minWidth }}>
          <button className="col" onClick={() => props.onSort('name')}>
            نام{sortMark('name')}
          </button>
          {props.columns.map((c) => {
            const meta = COL_META[c]
            return (
              <button
                key={c}
                className={'col' + (meta.end ? ' num' : '')}
                onClick={() => meta.sort && props.onSort(meta.sort)}
              >
                {meta.label}
                {meta.sort ? sortMark(meta.sort) : ''}
              </button>
            )
          })}
        </div>
        </div>
      )}

      <div
        className="rows"
        ref={listRef}
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop)
          if (headRef.current) headRef.current.scrollLeft = e.currentTarget.scrollLeft
        }}
        onDragOver={allowDrop}
        onDrop={(e) => dropOn(e, cur)}
        onContextMenu={(e) => menu(e, null)}
      >
        {pane.error ? (
          <div className="error">{pane.error}</div>
        ) : entries.length === 0 ? (
          <div className="empty">
            {pane.loading
              ? t('در حال خواندن…')
              : pane.virtual
                ? t('چیزی پیدا نشد')
                : pane.filter
                  ? t('چیزی با این نام نیست')
                  : t('پوشه خالی است')}
          </div>
        ) : view === 'list' ? (
          <div style={{ height: entries.length * ROW, position: 'relative', minWidth }}>
            {entries.slice(start, end).map((e, k) => (
              <div
                key={e.path}
                className={
                  'row' + (pane.sel.includes(e.path) ? ' on' : '') + (pinSet.has(e.name) ? ' pinned' : '')
                }
                style={{ top: (start + k) * ROW, gridTemplateColumns: gridTemplate }}
                title={e.path}
                draggable
                onDragStart={(ev) => startDrag(ev, e.path)}
                onDragOver={allowDrop}
                onDrop={(ev) => dropOn(ev, e.dir ? e.path : cur)}
                onContextMenu={(ev) => menu(ev, e.path)}
                onClick={(ev) => click(start + k, ev)}
                onDoubleClick={() => props.onOpen(e.path)}
              >
                <span className="name">
                  {!e.dir && props.typeColors[(e.ext || '').toLowerCase()] && (
                    <span
                      className="ftdot"
                      style={{ background: props.typeColors[(e.ext || '').toLowerCase()] }}
                      title={`نوع ${e.ext}`}
                    />
                  )}
                  {labelColor(e.name) && (
                    <span className="lbl" style={{ background: labelColor(e.name) }} title={t(t('برچسب'))} />
                  )}
                  {pinSet.has(e.name) && (
                    <span className="pinmark" title={t(t('سنجاق‌شده'))}>
                      <PinIcon filled />
                    </span>
                  )}
                  {e.dir ? <FolderGlyph entry={e} /> : e.icon ? <img className="ic-img" src={mediaUrl(e.icon)} alt="" /> : <TypeIcon entry={e} />}
                  <span dir="auto" className="trunc">{e.name}</span>
                </span>
                {props.columns.map((c) => (
                  <span key={c} className={COL_META[c].sort === 'mtime' || !COL_META[c].sort ? 'dim' : 'kind'}>
                    {cell(c, e)}
                  </span>
                ))}
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
                  draggable
                  onDragStart={(ev) => startDrag(ev, e.path)}
                  onDragOver={allowDrop}
                  onDrop={(ev) => dropOn(ev, e.dir ? e.path : cur)}
                  onContextMenu={(ev) => menu(ev, e.path)}
                  onClick={(ev) => click(idx, ev)}
                  onDoubleClick={() => props.onOpen(e.path)}
                  title={e.path}
                >
                  <span className="thumb">
                    {!e.dir && isImage(e.ext) && e.size < 8_000_000 ? (
                      <img
                        src={isImageName(e.name) ? thumbUrl(e.path, 256) : mediaUrl(e.path)}
                        alt=""
                        loading="lazy"
                        draggable={false}
                      />
                    ) : e.dir ? (
                      <FolderGlyph entry={e} size={34} />
                    ) : e.icon ? (
                      <img src={mediaUrl(e.icon)} alt="" />
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
