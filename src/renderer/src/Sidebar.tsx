import { t } from './i18n.ts'
import { useEffect, useState } from 'react'
import { api, type DirRef } from './api'
import { baseName } from './format'
import { ChevronDownIcon, ChevronLeftIcon, DriveIcon, FolderIcon, HomeIcon, PinIcon, StarIcon, XIcon } from './Icons'

type LabelCount = { id: string; name: string; color: string; count: number }

type Props = {
  labels: LabelCount[]
  onPickLabel(id: string): void
  roots: DirRef[]
  marks: string[]
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
  activePath,
  onNav,
  onUnmark,
  onMarkDrop,
  showHidden,
  floating,
  onToggleFloat
}: Props) {
  const [over, setOver] = useState(false)
  return (
    <aside
      className={'side' + (over ? ' drop' : '')}
      onDragOver={(ev) => {
        if (!ev.dataTransfer.types.includes('application/x-mfm')) return
        ev.preventDefault()
        ev.dataTransfer.dropEffect = 'link'
        setOver(true)
      }}
      onDragLeave={(ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setOver(false)
      }}
      onDrop={(ev) => {
        setOver(false)
        const raw = ev.dataTransfer.getData('application/x-mfm')
        if (!raw) return
        ev.preventDefault()
        ev.stopPropagation()
        try {
          onMarkDrop(JSON.parse(raw) as string[])
        } catch {
          // a foreign payload is not ours to act on
        }
      }}
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
      {roots.map((r) => (
        <TreeNode
          key={r.path}
          node={r}
          depth={0}
          activePath={activePath}
          showHidden={showHidden}
          onNav={onNav}
        />
      ))}

      {labels.length > 0 && <div className="side-title">{t(t('برچسب‌ها'))}</div>}
      {labels.map((l) => (
        <div key={l.id} className="tree-row">
          <span className="twisty" />
          <button className="tree-name" onClick={() => onPickLabel(l.id)} title={`فیلتر: ${l.name}`}>
            <span className="lbl" style={{ background: l.color }} />
            <span>{l.name}</span>
            <span className="dim count">{l.count}</span>
          </button>
        </div>
      ))}

      {(marks.length > 0 || over) && <div className="side-title">{t(t('نشان‌شده‌ها'))}</div>}
      {over && !marks.length && <div className="side-drop-hint">{t('پوشه را رها کن تا نشان شود')}</div>}
      {marks.map((m) => (
        <div key={m} className={'tree-row mark' + (activePath === m ? ' on' : '')}>
          <span className="twisty" />
          <button className="tree-name" dir="auto" title={m} onClick={() => onNav(m)}>
            <StarIcon filled size={13} />
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
function TreeNode({ node, depth, activePath, onNav, showHidden }: {
  node: DirRef
  depth: number
  activePath: string
  showHidden: boolean
  onNav(dir: string): void
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
      <div className={'tree-row' + (active ? ' on' : '')} style={{ paddingInlineStart: 6 + depth * 12 }}>
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
        />
      ))}
    </>
  )
}
