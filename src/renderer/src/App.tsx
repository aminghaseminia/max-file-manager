import { useEffect, useRef, useState } from 'react'
import { api, type DirRef, type OpKind } from './api'
import { Pane, type PaneState, type View } from './Pane'
import { Sidebar } from './Sidebar'
import { baseName, fa, fmtSize, orderEntries, type SortKey } from './format'
import {
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  GaugeIcon,
  GridIcon,
  ListIcon,
  MoonIcon,
  SunIcon
} from './Icons'

const newPane = (dir: string): PaneState => ({
  tabs: [dir],
  ti: 0,
  hist: [dir],
  hi: 0,
  sel: [],
  filter: '',
  listing: null,
  error: '',
  loading: true
})

const patch = (panes: PaneState[], i: number, p: Partial<PaneState>): PaneState[] =>
  panes.map((x, j) => (j === i ? { ...x, ...p } : x))

const tabOf = (s: PaneState) => s.tabs[s.ti]

const OP_LABEL: Record<string, string> = {
  copy: 'کپی',
  move: 'انتقال',
  trash: 'سطل بازیافت',
  delete: 'حذف',
  mkdir: 'پوشهٔ نو',
  rename: 'تغییر نام'
}

const SORT_KEYS: SortKey[] = ['name', 'size', 'mtime', 'ext']

export default function App() {
  const [panes, setPanes] = useState<PaneState[] | null>(null)
  const [roots, setRoots] = useState<DirRef[]>([])
  const [active, setActive] = useState(0)
  const [hidden, setHidden] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [view, setView] = useState<View>('list')
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true })
  const [marks, setMarks] = useState<string[]>([])
  const [sizes, setSizes] = useState<Record<string, string>>({})
  const [prompt, setPrompt] = useState<{ kind: 'mkdir' | 'rename'; value: string } | null>(null)
  const [note, setNote] = useState('')
  const [booted, setBooted] = useState(false)
  const filterEls = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // boot: restore the last session, fall back to home
  useEffect(() => {
    Promise.all([api.roots(), api.home(), api.state.get()]).then(([r, home, st]) => {
      setRoots(r)
      const s = st ?? {}
      if (typeof s.hidden === 'boolean') setHidden(s.hidden)
      if (s.theme === 'light' || s.theme === 'dark') setTheme(s.theme)
      if (s.view === 'grid' || s.view === 'list') setView(s.view)
      if (s.sort && SORT_KEYS.includes(s.sort.key as SortKey)) {
        setSort({ key: s.sort.key as SortKey, asc: !!s.sort.asc })
      }
      if (Array.isArray(s.marks)) setMarks(s.marks.filter((m) => typeof m === 'string' && m))
      if (s.active === 1) setActive(1)
      const mk = (p?: { tabs?: string[]; ti?: number }): PaneState => {
        const tabs = (p?.tabs ?? []).filter((t) => typeof t === 'string' && t)
        const list = tabs.length ? tabs : [home]
        const ti = Math.min(Math.max(p?.ti ?? 0, 0), list.length - 1)
        return { ...newPane(list[ti]), tabs: list, ti }
      }
      setPanes([mk(s.panes?.[0]), mk(s.panes?.[1])])
      setBooted(true)
    })
  }, [])

  // remember the session, debounced so a directory load doesn't hammer the disk
  useEffect(() => {
    if (!booted || !panes) return
    const t = setTimeout(() => {
      void api.state.set({
        panes: panes.map((p) => ({ tabs: p.tabs, ti: p.ti })),
        active,
        hidden,
        theme,
        sort,
        view,
        marks
      })
    }, 500)
    return () => clearTimeout(t)
  }, [booted, panes, active, hidden, theme, sort, view, marks])

  const path0 = panes ? tabOf(panes[0]) : ''
  const path1 = panes ? tabOf(panes[1]) : ''

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
    setPanes((p) => {
      if (!p) return p
      const s = p[i]
      const hist = [...s.hist.slice(0, s.hi + 1), dir]
      return patch(p, i, {
        tabs: s.tabs.map((t, j) => (j === s.ti ? dir : t)),
        sel: [],
        hist,
        hi: hist.length - 1
      })
    })

  const jump = (i: number, delta: number) =>
    setPanes((p) => {
      if (!p) return p
      const s = p[i]
      const hi = s.hi + delta
      if (hi < 0 || hi >= s.hist.length) return p
      return patch(p, i, { hi, tabs: s.tabs.map((t, j) => (j === s.ti ? s.hist[hi] : t)), sel: [] })
    })

  const up = (i: number) => {
    const parent = panes?.[i].listing?.parent
    if (parent) go(i, parent)
  }

  const runSel = async (i: number, kind: Extract<OpKind, 'copy' | 'move' | 'trash' | 'delete'>) => {
    if (!panes) return
    const me = panes[i]
    if (!me.sel.length) {
      setNote('چیزی انتخاب نشده')
      return
    }
    const dest = tabOf(panes[1 - i])
    const res = await api.op(kind, me.sel, dest)
    setNote(
      res.errors.length
        ? `${OP_LABEL[kind]}: ${fa(res.done)} انجام شد، ${fa(res.errors.length)} خطا — ${res.errors[0]}`
        : `${OP_LABEL[kind]}: ${fa(res.done)} مورد`
    )
    setPanes((p) => p && patch(p, i, { sel: [] }))
    await Promise.all([load(i, tabOf(me)), load(1 - i, dest)])
  }

  const computeSizes = async (i: number) => {
    if (!panes) return
    const me = panes[i]
    const targets = me.sel.length ? me.sel : [tabOf(me)]
    setNote('در حال محاسبهٔ اندازه…')
    for (const t of targets) {
      const r = await api.size(t)
      setSizes((s) => ({ ...s, [t]: fmtSize(r.bytes, false) + (r.capped ? '…' : '') }))
    }
    setNote(`اندازهٔ ${fa(targets.length)} مورد محاسبه شد`)
  }

  const submitPrompt = async () => {
    if (!panes || !prompt) return
    const value = prompt.value.trim()
    const { kind } = prompt
    setPrompt(null)
    if (!value) return
    const me = panes[active]
    const cur = tabOf(me)
    if (kind === 'rename' && !me.sel[0]) {
      setNote('چیزی انتخاب نشده')
      return
    }
    const res =
      kind === 'mkdir'
        ? await api.op('mkdir', [cur], undefined, value)
        : await api.op('rename', [me.sel[0]], undefined, value)
    setNote(res.errors.length ? `خطا — ${res.errors[0]}` : `${OP_LABEL[kind]}: ${value}`)
    await load(active, cur)
  }

  const openEntry = (i: number, p: string) => {
    const e = panes?.[i].listing?.entries.find((x) => x.path === p)
    if (!e) return
    if (e.dir) go(i, e.path)
    else void api.open(e.path)
  }

  const toggleMark = (i: number) => {
    const cur = panes?.[i] ? tabOf(panes[i]) : ''
    if (!cur) return
    setMarks((m) => (m.includes(cur) ? m.filter((x) => x !== cur) : [...m, cur]))
  }

  const visibleOf = (i: number) =>
    orderEntries(panes?.[i].listing?.entries ?? [], sort.key, sort.asc, panes?.[i].filter ?? '')

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
      if (!panes) return
      const me = panes[active]

      if (ev.altKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
        ev.preventDefault()
        jump(active, ev.key === 'ArrowLeft' ? -1 : 1)
        return
      }
      if (typing) return

      switch (ev.key) {
        case 'Tab':
          ev.preventDefault()
          setActive((a) => 1 - a)
          break
        case 'F5':
          ev.preventDefault()
          void runSel(active, 'copy')
          break
        case 'F6':
          ev.preventDefault()
          void runSel(active, 'move')
          break
        case 'F7':
          ev.preventDefault()
          setPrompt({ kind: 'mkdir', value: '' })
          break
        case 'F2':
          ev.preventDefault()
          if (me.sel[0]) setPrompt({ kind: 'rename', value: baseName(me.sel[0]) })
          break
        case 'F3':
          ev.preventDefault()
          void load(active, tabOf(me))
          break
        case 'F9':
          ev.preventDefault()
          void computeSizes(active)
          break
        case 'F8':
        case 'Delete':
          ev.preventDefault()
          void runSel(active, ev.shiftKey ? 'delete' : 'trash')
          break
        case 'Backspace':
        case 'ArrowUp':
          if (ev.key === 'ArrowUp' && !ev.ctrlKey) break
          ev.preventDefault()
          up(active)
          break
        case 'Enter':
          ev.preventDefault()
          if (me.sel[0]) openEntry(active, me.sel[0])
          break
        case 'Escape':
          ev.preventDefault()
          setPanes((p) => p && patch(p, active, { sel: [], filter: '' }))
          break
        case 'a':
        case 'A':
          if (ev.ctrlKey) {
            ev.preventDefault()
            setPanes((p) => p && patch(p, active, { sel: visibleOf(active).map((e) => e.path) }))
          }
          break
        case 'f':
        case 'F':
          if (ev.ctrlKey) {
            ev.preventDefault()
            filterEls.current[active]?.focus()
          }
          break
        case 'h':
        case 'H':
          if (ev.ctrlKey) {
            ev.preventDefault()
            setHidden((h) => !h)
          }
          break
        case 'd':
        case 'D':
          if (ev.ctrlKey) {
            ev.preventDefault()
            toggleMark(active)
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!panes) {
    return <div className="boot">در حال آماده‌سازی…</div>
  }

  const visible = visibleOf(active)
  const curPath = tabOf(panes[active])

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="logo">
            <FolderIcon />
          </span>
          مدیر فایل مکس
        </span>
        <span className="spacer" />
        <span className="note">{note}</span>
        <button
          className="tb"
          title={view === 'list' ? 'نمای شبکه' : 'نمای فهرست'}
          onClick={() => setView((v) => (v === 'list' ? 'grid' : 'list'))}
        >
          {view === 'list' ? <GridIcon /> : <ListIcon />}
        </button>
        <button className="tb" title="اندازهٔ پوشه (F9)" onClick={() => void computeSizes(active)}>
          <GaugeIcon />
        </button>
        <button
          className={'tb' + (hidden ? ' on' : '')}
          title="فایل‌های مخفی (Ctrl+H)"
          onClick={() => setHidden((h) => !h)}
        >
          {hidden ? <EyeIcon /> : <EyeOffIcon />}
        </button>
        <button
          className="tb"
          title={theme === 'dark' ? 'تم روشن' : 'تم تیره'}
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </header>

      <div className="body">
        <Sidebar
          roots={roots}
          marks={marks}
          activePath={curPath}
          onNav={(d) => go(active, d)}
          onUnmark={(m) => setMarks((x) => x.filter((y) => y !== m))}
        />

        {panes.map((pane, i) => (
          <Pane
            key={i}
            index={i}
            pane={pane}
            active={i === active}
            sort={sort}
            view={view}
            sizes={sizes}
            marked={marks.includes(tabOf(pane))}
            filterRef={(el) => {
              filterEls.current[i] = el
            }}
            onActivate={() => setActive(i)}
            onSort={(key) => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}
            onNav={(dir) => go(i, dir)}
            onBack={() => jump(i, -1)}
            onForward={() => jump(i, 1)}
            onUp={() => up(i)}
            onRefresh={() => void load(i, tabOf(pane))}
            onOpen={(path) => openEntry(i, path)}
            onSel={(sel) => setPanes((p) => p && patch(p, i, { sel }))}
            onFilter={(q) => setPanes((p) => p && patch(p, i, { filter: q }))}
            onTabNew={() =>
              setPanes(
                (p) => p && patch(p, i, { tabs: [...p[i].tabs, tabOf(p[i])], ti: p[i].tabs.length })
              )
            }
            onTabClose={(idx) =>
              setPanes((p) => {
                if (!p) return p
                const tabs = p[i].tabs.filter((_, j) => j !== idx)
                if (!tabs.length) return p
                return patch(p, i, { tabs, ti: Math.min(p[i].ti, tabs.length - 1) })
              })
            }
            onTabPick={(idx) => setPanes((p) => p && patch(p, i, { ti: idx, sel: [] }))}
            onOp={(kind) => {
              if (kind === 'mkdir') setPrompt({ kind: 'mkdir', value: '' })
              else if (kind === 'rename') {
                if (pane.sel[0]) setPrompt({ kind: 'rename', value: baseName(pane.sel[0]) })
                else setNote('چیزی انتخاب نشده')
              } else void runSel(i, kind)
            }}
            onSize={() => void computeSizes(i)}
            onBookmark={() => toggleMark(i)}
          />
        ))}
      </div>

      <footer className="status">
        <span>
          {panes[active].listing
            ? `${fa(visible.length)} مورد`
            : panes[active].loading
              ? 'در حال خواندن…'
              : 'فهرستی نیست'}
        </span>
        <span>{panes[active].sel.length ? `${fa(panes[active].sel.length)} انتخاب‌شده` : ''}</span>
        <span className="spacer" />
        <span className="keys">
          F5 کپی · F6 انتقال · F7 پوشهٔ نو · F8 سطل · F2 تغییر نام · F9 اندازه · Ctrl+A همه · Tab پنجره
        </span>
      </footer>

      {prompt && (
        <div className="modal" onMouseDown={() => setPrompt(null)}>
          <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="dlg-title">{prompt.kind === 'mkdir' ? 'نام پوشهٔ نو' : 'نام تازه'}</div>
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
              <button onClick={() => void submitPrompt()}>تأیید</button>
              <button onClick={() => setPrompt(null)}>انصراف</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
