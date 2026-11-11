import { t } from './i18n.ts'
import { useEffect, useState } from 'react'
import { api, type DirRef } from './api'
import { baseName } from './format'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  DriveIcon,
  FolderIcon,
  HomeIcon,
  StarIcon,
  XIcon
} from './Icons'

type LabelCount = { id: string; name: string; color: string; count: number }

type Props = {
  labels: LabelCount[]
  onPickLabel(id: string): void
  roots: DirRef[]
  marks: string[]
  activePath: string
  onNav(dir: string): void
  onUnmark(dir: string): void
}

export function Sidebar({ labels, onPickLabel, roots, marks, activePath, onNav, onUnmark }: Props) {
  return (
    <aside className="side">
      <div className="side-title">{t(t('مکان‌ها'))}</div>
      {roots.map((r) => (
        <TreeNode key={r.path} node={r} depth={0} activePath={activePath} onNav={onNav} />
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

      {marks.length > 0 && <div className="side-title">{t(t('نشان‌شده‌ها'))}</div>}
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
function TreeNode({ node, depth, activePath, onNav }: {
  node: DirRef
  depth: number
  activePath: string
  onNav(dir: string): void
}) {
  const [open, setOpen] = useState(false)
  const [kids, setKids] = useState<DirRef[] | null>(null)

  useEffect(() => {
    if (open && !kids) void api.dirs(node.path).then(setKids).catch(() => setKids([]))
  }, [open, kids, node.path])

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
        <TreeNode key={k.path} node={k} depth={depth + 1} activePath={activePath} onNav={onNav} />
      ))}
    </>
  )
}
