import { useEffect, useState } from 'react'
import { api, type OpKind } from './api'
import { Pane, type PaneState } from './Pane'
import { baseName, sortEntries, type SortKey } from './format'

const newPane = (dir: string): PaneState => ({
  tabs: [dir],
  ti: 0,
  sel: [],
  listing: null,
  error: '',
  loading: true
})

const patch = (panes: PaneState[], i: number, p: Partial<PaneState>): PaneState[] =>
  panes.map((x, j) => (j === i ? { ...x, ...p } : x))

export default function App() {
  const [panes, setPanes] = useState<PaneState[] | null>(null)
  const [roots, setRoots] = useState<{ name: string; path: string }[]>([])
  const [active, setActive] = useState(0)
  const [hidden, setHidden] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true })
  const [prompt, setPrompt] = useState<{ kind: 'mkdir' | 'rename'; value: string } | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    Promise.all([api.roots(), api.home()]).then(([r, home]) => {
      setRoots(r)
      setPanes([newPane(home), newPane(home)])
    })
  }, [])

  const path0 = panes ? panes[0].tabs[panes[0].ti] : ''
  const path1 = panes ? panes[1].tabs[panes[1].ti] : ''

  const load = async (i: number, dir: string) => {
    setPanes((p) => p && patch(p, i, { loading: true }))
    try {
      const listing = await api.list(dir, hidden)
      setPanes((p) => p && patch(p, i, { listing, error: '', loading: false }))
    } catch (e: any) {
      setPanes((p) => p && patch(p, i, { listing: null, error: String(e?.message ?? e), loading: false }))
    }
  }

  useEffect(() => {
    if (path0) void load(0, path0)
  }, [path0, hidden])
  useEffect(() => {
    if (path1) void load(1, path1)
  }, [path1, hidden])

  const go = (i: number, dir: string) =>
    setPanes((p) => p && patch(p, i, { tabs: p[i].tabs.map((t, j) => (j === p[i].ti ? dir : t)), sel: [] }))

  const up = (i: number) => {
    const parent = panes?.[i].listing?.parent
    if (parent) go(i, parent)
  }

  const refreshBoth = async (dest: string) => {
    if (!panes) return
    await Promise.all([load(active, panes[active].tabs[panes[active].ti]), load(1 - active, dest)])
  }

  const runSel = async (kind: Extract<OpKind, 'copy' | 'move' | 'trash' | 'delete'>) => {
    if (!panes) return
    const me = panes[active]
    const sel = me.sel
    if (!sel.length) {
      setNote('nothing selected')
      return
    }
    const dest = panes[1 - active].tabs[panes[1 - active].ti]
    const res = await api.op(kind, sel, dest)
    setNote(
      res.errors.length
        ? `${kind}: ${res.done} done · ${res.errors.length} failed — ${res.errors[0]}`
        : `${kind}: ${res.done} item(s)`
    )
    setPanes((p) => p && patch(p, active, { sel: [] }))
    await refreshBoth(dest)
  }

  const submitPrompt = async () => {
    if (!panes || !prompt) return
    const value = prompt.value.trim()
    const { kind } = prompt
    setPrompt(null)
    if (!value) return
    const me = panes[active]
    const cur = me.tabs[me.ti]
    if (kind === 'rename' && !me.sel[0]) {
      setNote('nothing selected')
      return
    }
    const res =
      kind === 'mkdir'
        ? await api.op('mkdir', [cur], undefined, value)
        : await api.op('rename', [me.sel[0]], undefined, value)
    setNote(res.errors.length ? `failed — ${res.errors[0]}` : `${kind}: ${value}`)
    await load(active, cur)
  }

  const openEntry = (i: number, p: string) => {
    const e = panes?.[i].listing?.entries.find((x) => x.path === p)
    if (!e) return
    if (e.dir) go(i, e.path)
    else void api.open(e.path)
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (!panes) return
      const me = panes[active]
      switch (ev.key) {
        case 'Tab':
          ev.preventDefault()
          setActive((a) => 1 - a)
          break
        case 'F5':
          ev.preventDefault()
          void runSel('copy')
          break
        case 'F6':
          ev.preventDefault()
          void runSel('move')
          break
        case 'F7':
          ev.preventDefault()
          setPrompt({ kind: 'mkdir', value: 'New folder' })
          break
        case 'F2':
          ev.preventDefault()
          if (me.sel[0]) setPrompt({ kind: 'rename', value: baseName(me.sel[0]) })
          break
        case 'F3':
          ev.preventDefault()
          void load(active, me.tabs[me.ti])
          break
        case 'F8':
        case 'Delete':
          ev.preventDefault()
          void runSel(ev.shiftKey ? 'delete' : 'trash')
          break
        case 'Backspace':
          ev.preventDefault()
          up(active)
          break
        case 'Enter':
          ev.preventDefault()
          if (me.sel[0]) openEntry(active, me.sel[0])
          break
        case 'h':
        case 'H':
          if (ev.ctrlKey) {
            ev.preventDefault()
            setHidden((h) => !h)
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!panes) {
    return <div className="boot">loading…</div>
  }

  const visible = panes[active].listing
    ? sortEntries(panes[active].listing.entries, sort.key, sort.asc)
    : []

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Max File Manager</span>
        <span className="spacer" />
        <span className="note">{note}</span>
        <button className="tb" onClick={() => setHidden((h) => !h)} title="Hidden files (Ctrl+H)">
          {hidden ? '· hidden on' : '· hidden off'}
        </button>
        <button
          className="tb"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          title="Theme"
        >
          {theme === 'dark' ? 'light theme' : 'dark theme'}
        </button>
      </header>

      <div className="body">
        <aside className="side">
          {roots.map((r) => (
            <button
              key={r.path}
              className="root"
              dir="auto"
              title={r.path}
              onClick={() => go(active, r.path)}
            >
              {r.name}
            </button>
          ))}
        </aside>

        {panes.map((pane, i) => (
          <Pane
            key={i}
            index={i}
            pane={pane}
            visible={i === active ? visible : null}
            active={i === active}
            sort={sort}
            onActivate={() => setActive(i)}
            onSort={(key) =>
              setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))
            }
            onNav={(dir) => go(i, dir)}
            onUp={() => up(i)}
            onRefresh={() => void load(i, panes[i].tabs[panes[i].ti])}
            onOpen={(path) => openEntry(i, path)}
            onSel={(sel) => setPanes((p) => p && patch(p, i, { sel }))}
            onTabNew={() => setPanes((p) => p && patch(p, i, { tabs: [...p[i].tabs, p[i].tabs[p[i].ti]], ti: p[i].tabs.length }))}
            onTabClose={(idx) =>
              setPanes((p) => {
                if (!p) return p
                const tabs = p[i].tabs.filter((_, j) => j !== idx)
                if (!tabs.length) return p
                return patch(p, i, { tabs, ti: Math.min(p[i].ti, tabs.length - 1) })
              })
            }
            onTabPick={(idx) => setPanes((p) => p && patch(p, i, { ti: idx, sel: [] }))}
          />
        ))}
      </div>

      <footer className="status">
        <span>{panes[active].listing ? `${visible.length} items` : panes[active].loading ? 'reading…' : 'no listing'}</span>
        <span>{panes[active].sel.length ? `${panes[active].sel.length} selected` : ''}</span>
        <span className="spacer" />
        <span className="keys">F5 copy · F6 move · F7 new folder · F8 trash · Shift+F8 delete · F2 rename · Tab switch pane</span>
      </footer>

      {prompt && (
        <div className="modal" onMouseDown={() => setPrompt(null)}>
          <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="dlg-title">{prompt.kind === 'mkdir' ? 'New folder' : 'Rename'}</div>
            <input
              autoFocus
              dir="auto"
              value={prompt.value}
              onChange={(e) => setPrompt({ ...prompt, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitPrompt()
                if (e.key === 'Escape') setPrompt(null)
              }}
            />
            <div className="dlg-actions">
              <button onClick={() => void submitPrompt()}>OK</button>
              <button onClick={() => setPrompt(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
