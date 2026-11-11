import { useEffect, useState } from 'react'
import { api, type DirRef } from './api'
import { ChevronDownIcon, ChevronLeftIcon, FolderIcon } from './Icons'

type Props = {
  /** current folder of the pane */
  path: string
  onNav(dir: string): void
}

const split = (p: string) => p.split('/').filter(Boolean)
const join = (parts: string[]) => '/' + parts.join('/')

/** Ancestors of the folder plus its own sub-folders, expanded lazily. */
export function PaneTree({ path, onNav }: Props) {
  const parts = split(path)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [kids, setKids] = useState<Record<string, DirRef[]>>({})

  useEffect(() => {
    let live = true
    const load = async () => {
      const targets = Object.entries(open)
        .filter(([, on]) => on)
        .map(([dir]) => dir)
      for (const dir of targets) {
        if (kids[dir]) continue
        const list = await api.dirs(dir)
        if (!live) return
        setKids((k) => ({ ...k, [dir]: list }))
      }
    }
    void load()
    return () => {
      live = false
    }
  }, [open, kids])

  const toggle = (dir: string) => setOpen((o) => ({ ...o, [dir]: !o[dir] }))

  const row = (dir: string, label: string, depth: number, hasKids: boolean) => (
    <div className={'ptree-row' + (dir === path ? ' on' : '')} style={{ paddingInlineStart: depth * 12 + 6 }}>
      <button
        className="ptree-twisty"
        onClick={() => hasKids && toggle(dir)}
        title={open[dir] ? 'بستن' : 'باز کردن'}
      >
        {hasKids ? open[dir] ? <ChevronDownIcon size={11} /> : <ChevronLeftIcon size={11} /> : null}
      </button>
      <button className="ptree-name" dir="auto" title={dir} onClick={() => onNav(dir)}>
        <FolderIcon />
        <span>{label}</span>
      </button>
    </div>
  )

  const branch = (dir: string, depth: number) => (
    <div key={dir}>
      {row(dir, split(dir).pop() ?? dir, depth, true)}
      {open[dir] &&
        (kids[dir] ?? []).map((k) => (
          <div key={k.path} style={{ paddingInlineStart: (depth + 1) * 12 + 6 }}>
            <button className="ptree-name" dir="auto" title={k.path} onClick={() => onNav(k.path)}>
              <FolderIcon />
              <span>{k.name}</span>
            </button>
          </div>
        ))}
    </div>
  )

  return (
    <div className="ptree">
      {row('/', 'ریشه', 0, true)}
      {parts.map((_, i) => branch(join(parts.slice(0, i + 1)), i + 1))}
    </div>
  )
}
