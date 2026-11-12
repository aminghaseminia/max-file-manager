import { t } from './i18n.ts'
import { useEffect, useRef, useState } from 'react'
import { api, type DirRef } from './api'
import { baseName } from './format'
import { clearDragPaths, keepDragPaths, lastDragPaths } from './drag'
import { dragLog } from './draglog'
import { ChevronDownIcon, ChevronLeftIcon, DriveIcon, EntryIcon, FolderIcon, HomeIcon, PinIcon, StarIcon, XIcon } from './Icons'

type LabelCount = { id: string; name: string; color: string; count: number }

/** `file://` URI → path, the shape external file managers put on the drag. */
const fileUrlToPath = (uri: string): string => {
  try {
    const url = new URL(uri)
    if (url.protocol !== 'file:') return ''
    let p = decodeURIComponent(url.pathname)
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
    return p
  } catch {
    return ''
  }
}

/** Our own payload, or the `Files`/`uri-list` an external file manager sends. */
const pathsOf = (dt: DataTransfer): string[] => {
  const raw = dt.getData('application/x-mfm') || dt.getData('application/x-mfm-mark')
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        const list = parsed.filter((p): p is string => typeof p === 'string')
        if (list.length) return list
      }
    } catch {
      // fall through to the in-memory copy of our own drag
    }
  }
  // a Wayland drop can lose the custom data; the drag that started here is still known
  const internal = lastDragPaths()
  if (internal.length) return internal
  if (dt.files.length) {
    return [...dt.files].map((f) => api.pathForFile(f)).filter(Boolean)
  }
  const list = dt.getData('text/uri-list') || dt.getData('text/plain')
  return list
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('file://'))
    .map(fileUrlToPath)
    .filter(Boolean)
}

type Props = {
  labels: LabelCount[]
  onPickLabel(id: string): void
  roots: DirRef[]
  marks: string[]
  /** each bookmark's own folder colour/icon, resolved once by the app */
  markIcons: Record<string, { color?: string; icon?: string }>
  iconSet?: Record<string, string>
  activePath: string
  onNav(dir: string): void
  onUnmark(dir: string): void
  /** folders dropped on the sidebar become bookmarks */
  onMarkDrop(paths: string[]): void
  /** marked-hidden folders follow the pane's hidden-files switch */
  showHidden: boolean
  /** the sidebar is floating over the panes; the pin docks it again */
  floating: boolean
  onToggleFloat(): void
}

export function Sidebar({
  labels,
  onPickLabel,
  roots,
  marks,
  markIcons,
  iconSet,
  activePath,
  onNav,
  onUnmark,
  onMarkDrop,
  showHidden,
  floating,
  onToggleFloat
}: Props) {
  const [over, setOver] = useState(false)
  const ref = useRef<HTMLElement>(null)
  const lastOver = useRef<{ x: number; y: number; at: number } | null>(null)
  const dragCounter = useRef(0)
  const dropped = useRef(false)
  const markDrop = useRef(onMarkDrop)
  useEffect(() => {
    markDrop.current = onMarkDrop
  }, [onMarkDrop])
  /** Enter and over both count: a drop must work even if the pointer stops moving. */
  const acceptDrag = (ev: React.DragEvent) => {
    const types = ev.dataTransfer.types
    const ours = types.includes('application/x-mfm') || types.includes('application/x-mfm-mark')
    const outside = types.includes('Files') || types.includes('text/uri-list')
    if (!ours && !outside && !lastDragPaths().length) return
    ev.preventDefault()
    ev.dataTransfer.dropEffect = 'link'
    lastOver.current = { x: ev.clientX, y: ev.clientY, at: performance.now() }
    setOver(true)
    dragLog(
      `over ${ev.type} at ${ev.clientX},${ev.clientY} types=${[...ev.dataTransfer.types].join('|')}`
    )
  }

  const handleDragEnter = (ev: React.DragEvent) => {
    dragCounter.current++
    acceptDrag(ev)
  }

  const handleDragLeave = (ev: React.DragEvent) => {
    dragCounter.current--
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setOver(false)
      dragLog(`leave exit counter=0 over=false`)
    }
  }

  const handleDrop = (ev: React.DragEvent) => {
    dropped.current = true
    dragCounter.current = 0
    setOver(false)
    ev.preventDefault()
    ev.stopPropagation()
    const paths = pathsOf(ev.dataTransfer)
    dragLog(
      `drop at ${ev.clientX},${ev.clientY} types=${[...ev.dataTransfer.types].join('|')} getData='${ev.dataTransfer
        .getData('application/x-mfm')}' internal='${lastDragPaths().join(',')}' files=${ev.dataTransfer.files.length} resolved='${paths.join(',')}'`
    )
    if (!paths.length) return
    onMarkDrop(paths)
  }

  // a refused drag (a file, or a drop outside) must not leave the sidebar highlighted
  useEffect(() => {
    const onDrop = () => {
      dropped.current = true
      dragCounter.current = 0
    }
    /**
     * Wayland can end the drag over the sidebar without ever sending `drop`. If the last
     * dragover was inside the sidebar and the drag was not cancelled, the release still means
     * «bookmark this folder» — so the in-memory paths are applied here.
     */
    const onEnd = (ev: DragEvent) => {
      const wasDropped = dropped.current
      const point = lastOver.current
      const paths = lastDragPaths()
      dropped.current = false
      lastOver.current = null
      dragCounter.current = 0
      setOver(false)
      clearDragPaths()
      dragLog(
        `dragend at ${ev.clientX},${ev.clientY} effect=${ev.dataTransfer?.dropEffect} wasDropped=${wasDropped} paths='${paths.join(',')}' point=${point ? `${point.x},${point.y} ${Math.round(performance.now() - point.at)}ms` : '-'}`
      )
      if (wasDropped || !paths.length || !point) return
      if (performance.now() - point.at > 3000) return
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      if (point.x < r.left || point.x > r.right || point.y < r.top || point.y > r.bottom) return
      markDrop.current(paths)
    }
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onEnd)
    return () => {
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onEnd)
    }
  }, [])
  return (
    <aside
      ref={ref}
      className={'side' + (over ? ' drop' : '')}
      onDragEnter={handleDragEnter}
      onDragOver={acceptDrag}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="side-head">
        <span className="side-title">{t(t('مکان‌ها'))}</span>
        <button
          type="button"
          className={'side-pin' + (floating ? ' on' : '')}
          title={floating ? t('چسباندن سایدبار') : t('شناور کردن سایدبار')}
          aria-label={floating ? t('چسباندن سایدبار') : t('شناور کردن سایدبار')}
          aria-pressed={floating}
          onClick={onToggleFloat}
        >
          <PinIcon filled={floating} />
        </button>
      </div>
      {over && (
        <div className="side-drop-hint">
          <StarIcon size={12} />
          <span>{t('پوشه را رها کن تا نشان شود')}</span>
        </div>
      )}
      {roots.map((r) => (
        <TreeNode
          key={r.path}
          node={r}
          depth={0}
          activePath={activePath}
          showHidden={showHidden}
          onNav={onNav}
          onDragOver={acceptDrag}
          onDrop={handleDrop}
        />
      ))}

      {labels.length > 0 && <div className="side-title">{t(t('برچسب‌ها'))}</div>}
      {labels.map((l) => (
        <div key={l.id} className="tree-row">
          <span className="twisty" />
          <button className="tree-name" onClick={() => onPickLabel(l.id)} title={`${t('فیلتر')}: ${t(l.name)}`}>
            <span className="lbl" style={{ background: l.color }} />
            <span>{t(l.name)}</span>
            <span className="dim count">{l.count}</span>
          </button>
        </div>
      ))}

      {(marks.length > 0 || over) && <div className="side-title">{t(t('نشان‌شده‌ها'))}</div>}
      {marks.map((m) => (
        <div key={m} className={'tree-row mark' + (activePath === m ? ' on' : '')}>
          <span className="twisty" />
          <button className="tree-name" dir="auto" title={m} onClick={() => onNav(m)}>
            <EntryIcon
              size={14}
              iconSet={iconSet}
              entry={{
                name: baseName(m),
                path: m,
                dir: true,
                size: 0,
                mtime: 0,
                ext: '',
                color: markIcons[m]?.color,
                icon: markIcons[m]?.icon
              }}
            />
            <span>{baseName(m)}</span>
          </button>
          <button className="x" title={t(t('حذف نشان'))} onClick={() => onUnmark(m)}>
            <XIcon size={12} />
          </button>
        </div>
      ))}
    </aside>
  )
}

/** Lazily loaded folder tree: children are fetched only when a node opens. */
function TreeNode({ node, depth, activePath, onNav, showHidden, onDragOver, onDrop }: {
  node: DirRef
  depth: number
  activePath: string
  showHidden: boolean
  onNav(dir: string): void
  onDragOver?(ev: React.DragEvent): void
  onDrop?(ev: React.DragEvent): void
}) {
  const [open, setOpen] = useState(false)
  const [kids, setKids] = useState<DirRef[] | null>(null)

  useEffect(() => {
    if (open && !kids) void api.dirs(node.path, showHidden).then(setKids).catch(() => setKids([]))
  }, [open, kids, node.path, showHidden])

  const active = activePath === node.path
  const Glyph = depth === 0 ? (node.name === '~' ? HomeIcon : DriveIcon) : FolderIcon
  const label = node.name === '~' ? t('خانه') : node.name === '/' ? t('ریشه') : node.name

  return (
    <>
      <div
        className={'tree-row' + (active ? ' on' : '')}
        style={{ paddingInlineStart: 6 + depth * 12 }}
        draggable
        onDragStart={(ev) => {
          // its own type: dropping it on a pane must not copy the folder, only the sidebar listens
          keepDragPaths([node.path])
          dragLog(`tree start ${node.path}`)
          ev.dataTransfer.setData('application/x-mfm-mark', JSON.stringify([node.path]))
          ev.dataTransfer.effectAllowed = 'all'
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <button className="twisty" onClick={() => setOpen((o) => !o)} aria-label={t(t('باز/بسته'))}>
          {open ? <ChevronDownIcon size={12} /> : <ChevronLeftIcon size={12} />}
        </button>
        <button className="tree-name" dir="auto" title={node.path} onClick={() => onNav(node.path)}>
          <Glyph />
          <span>{label}</span>
        </button>
      </div>
      {open && kids?.map((k) => (
        <TreeNode
          key={k.path}
          node={k}
          depth={depth + 1}
          activePath={activePath}
          showHidden={showHidden}
          onNav={onNav}
          onDragOver={onDragOver}
          onDrop={onDrop}
        />
      ))}
    </>
  )
}
