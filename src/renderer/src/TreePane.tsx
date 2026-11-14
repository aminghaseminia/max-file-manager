import { t } from './i18n.ts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type DirRef } from './api'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  FolderIcon,
  LocateIcon,
  MinusIcon,
  PinIcon,
  PlusIcon,
  XIcon
} from './Icons'

type Props = {
  /** the active pane's folder: the tree follows it unless auto-focus is off */
  path: string
  showHidden: boolean
  /** 'left' | 'right' decides which way the resize handle reads */
  side: 'left' | 'right'
  width: number
  autoFocus: boolean
  onNav(dir: string): void
  onAutoFocus(on: boolean): void
  onClose(): void
}

const ROW = 26
const OVERSCAN = 8

type Row = { path: string; name: string; depth: number; hasKids: boolean; open: boolean }

const parentOf = (p: string): string => {
  if (p === '/' || !p) return '/'
  const i = p.replace(/\/+$/, '').lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

/** '/' plus every folder between it and `p`. */
const ancestors = (p: string): string[] => {
  const out: string[] = []
  let cur = p.replace(/\/+$/, '')
  while (cur && cur !== '/') {
    out.unshift(cur)
    cur = parentOf(cur)
  }
  out.unshift('/')
  return out
}

/**
 * A real folder tree in its own pane: lazily loaded, virtualised (a wide `usr/share` branch
 * must stay cheap), following the active pane unless the user turns that off.
 */
export function TreePane({
  path,
  showHidden,
  side,
  width,
  autoFocus,
  onNav,
  onAutoFocus,
  onClose
}: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({ '/': true })
  const [kids, setKids] = useState<Record<string, DirRef[]>>({})
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(480)
  /** a folder to bring into view once the rows that contain it exist */
  const [pending, setPending] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** the hidden switch invalidates every cached child list */
  const hiddenRef = useRef(showHidden)

  const load = useCallback(
    async (dir: string): Promise<void> => {
      const list = await api.dirs(dir, showHidden).catch(() => [])
      setKids((k) => ({ ...k, [dir]: list }))
    },
    [showHidden]
  )

  useEffect(() => {
    if (hiddenRef.current === showHidden) return
    hiddenRef.current = showHidden
    setKids({})
  }, [showHidden])

  useEffect(() => {
    if (!kids['/']) void load('/')
  }, [kids, load])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewport(el.clientHeight))
    observer.observe(el)
    setViewport(el.clientHeight)
    return () => observer.disconnect()
  }, [])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const walk = (dir: string, name: string, depth: number): void => {
      const list = kids[dir]
      const expanded = !!open[dir]
      out.push({ path: dir, name, depth, hasKids: list ? list.length > 0 : true, open: expanded })
      if (!expanded || !list) return
      for (const k of list) walk(k.path, k.name, depth + 1)
    }
    walk('/', '/', 0)
    return out
  }, [kids, open])

  const toggle = (dir: string): void => {
    const next = !open[dir]
    setOpen((o) => ({ ...o, [dir]: next }))
    if (next && !kids[dir]) void load(dir)
  }

  /** Expand every ancestor of `target`, load the levels, then remember where to scroll. */
  const reveal = useCallback(
    async (target: string): Promise<void> => {
      const chain = ancestors(target)
      for (const dir of chain.slice(0, -1)) {
        setOpen((o) => (o[dir] ? o : { ...o, [dir]: true }))
        if (!kids[dir]) await load(dir)
      }
      // rows are virtualised, so the row may not be in the DOM yet: scroll by index instead
      setPending(target)
    },
    [kids, load]
  )

  useEffect(() => {
    if (!pending) return
    const index = rows.findIndex((r) => r.path === pending)
    if (index < 0) return // ancestors are still loading; the next rows change retries
    const el = scrollRef.current
    if (el) {
      const top = Math.max(0, index * ROW - Math.round(viewport / 2) + ROW)
      el.scrollTo({ top })
      setScrollTop(top)
    }
    setPending(null)
  }, [rows, pending, viewport])

  // auto-focus: follow the active pane, but never fight the user's own scrolling mid-frame
  useEffect(() => {
    if (!autoFocus || !path) return
    void reveal(path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, autoFocus, showHidden])

  const expandCurrent = (): void => {
    if (!open[path]) setOpen((o) => ({ ...o, [path]: true }))
    if (!kids[path]) void load(path)
  }

  const collapseAll = (): void => {
    setOpen({ '/': true })
    setScrollTop(0)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  const start = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN)
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW) + OVERSCAN)

  return (
    <section
      className={`tree-pane tree-pane-${side}`}
      style={{ width }}
      aria-label={t('درخت پوشه‌ها')}
    >
      <div className="tree-pane-head">
        <span className="tree-pane-title" title={t('درخت پوشه‌ها')}>
          {t('درخت')}
        </span>
        <button className="tb" title={t('نمایش پوشهٔ جاری در درخت')} onClick={() => void reveal(path)}>
          <LocateIcon />
        </button>
        <button
          className={'tb' + (autoFocus ? ' on' : '')}
          title={autoFocus ? t('خودکار روشن است — خاموش کن') : t('خودکار خاموش است — روشن کن')}
          aria-pressed={autoFocus}
          onClick={() => onAutoFocus(!autoFocus)}
        >
          <PinIcon filled={autoFocus} />
        </button>
        <button className="tb" title={t('باز کردن پوشهٔ جاری')} onClick={expandCurrent}>
          <PlusIcon />
        </button>
        <button className="tb" title={t('بستن همه')} onClick={collapseAll}>
          <MinusIcon />
        </button>
        <button className="tb" title={t('بستن درخت')} onClick={onClose}>
          <XIcon />
        </button>
      </div>

      <div
        className="tree-pane-scroll"
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="tree-pane-spacer" style={{ height: rows.length * ROW }}>
          {rows.slice(start, end).map((row, i) => {
            const index = start + i
            return (
              <div
                key={row.path}
                className={
                  'tree-pane-row' + (row.path === path ? ' on' : '') + (row.path === '/' ? ' root' : '')
                }
                style={{ top: index * ROW, paddingInlineStart: 4 + row.depth * 13 }}
              >
                <button
                  className={'tree-pane-twisty' + (row.hasKids ? '' : ' empty')}
                  tabIndex={row.hasKids ? 0 : -1}
                  aria-hidden={!row.hasKids}
                  title={row.open ? t('بستن') : t('باز کردن')}
                  onClick={() => row.hasKids && toggle(row.path)}
                >
                  {row.hasKids ? (
                    row.open ? (
                      <ChevronDownIcon size={11} />
                    ) : (
                      <ChevronLeftIcon size={11} />
                    )
                  ) : null}
                </button>
                <button
                  className="tree-pane-name"
                  dir="auto"
                  title={row.path}
                  onClick={() => onNav(row.path)}
                  onDoubleClick={() => toggle(row.path)}
                >
                  <FolderIcon size={14} />
                  <span>{row.path === '/' ? t('ریشه') : row.name}</span>
                </button>
              </div>
            )
          })}
        </div>
        {rows.length <= 1 && <div className="tree-pane-note">{t('در حال خواندن…')}</div>}
      </div>
    </section>
  )
}
