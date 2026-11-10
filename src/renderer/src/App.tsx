import { useEffect, useRef, useState } from 'react'
import { api, type Chrome, type DirRef, type Entry, type FolderMeta, type Job } from './api'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { FolderDialog } from './FolderDialog'
import { JobsBar } from './JobsBar'
import { Pane, type PaneState, type SearchQuery, type View } from './Pane'
import { PreviewPanel } from './PreviewPanel'
import { RenameDialog } from './RenameDialog'
import { SettingsPanel, type UiPrefs } from './SettingsPanel'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'
import {
  baseName,
  dirOf,
  fa,
  fmtSize,
  isArchiveName,
  joinPath,
  orderEntries,
  type SortKey
} from './format'
import {
  ArchiveOpenIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  FolderPlusIcon,
  GaugeIcon,
  GridIcon,
  LayersIcon,
  ListIcon,
  MenuIcon,
  MoonIcon,
  MoveIcon,
  PaletteIcon,
  PlayIcon,
  PlusIcon,
  PreviewIcon,
  RefreshIcon,
  RenameIcon,
  SettingsIcon,
  SunIcon,
  TrashIcon,
  UndoIcon
} from './Icons'

const newPane = (dir: string): PaneState => ({
  tabs: [dir],
  ti: 0,
  hist: [dir],
  hi: 0,
  sel: [],
  filter: '',
  listing: null,
  virtual: null,
  results: null,
  archive: null,
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
  delete: 'حذف'
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
  const [jobs, setJobs] = useState<Job[]>([])
  const [prompt, setPrompt] = useState<{ kind: 'mkdir' | 'rename'; value: string } | null>(null)
  const [renameTargets, setRenameTargets] = useState<string[] | null>(null)
  const [note, setNote] = useState('')
  const [chrome, setChrome] = useState<Chrome>({ customTitlebar: true, rounded: true })
  const [ui, setUi] = useState<UiPrefs>({ sidebar: 'docked', sidebarOpen: true })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [menu, setMenu] = useState<{ path: string | null; x: number; y: number } | null>(null)
  const [previewOn, setPreviewOn] = useState(false)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [folderLook, setFolderLook] = useState<{ dir: string; name: string; meta: FolderMeta | null } | null>(
    null
  )
  const [booted, setBooted] = useState(false)
  const filterEls = useRef<(HTMLInputElement | null)[]>([])
  const refreshRef = useRef<() => void>(() => {})

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    void api.window.getChrome().then(setChrome)
  }, [])

  // rounded corners are CSS on a transparent frameless window; nothing else can round it
  useEffect(() => {
    const on = chrome.customTitlebar && chrome.rounded
    document.documentElement.dataset.rounded = on ? '1' : '0'
    document.documentElement.style.setProperty('--chrome-h', chrome.customTitlebar ? '36px' : '0px')
  }, [chrome])

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
      if (s.ui) {
        setUi({
          sidebar: s.ui.sidebar === 'float' ? 'float' : 'docked',
          sidebarOpen: s.ui.sidebarOpen !== false,
          iconDirs: Array.isArray(s.ui.iconDirs) ? s.ui.iconDirs.filter((d) => typeof d === 'string') : [],
          iconTheme: typeof s.ui.iconTheme === 'string' ? s.ui.iconTheme : undefined
        })
      }
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

  // transfers report progress from the main process; a finished job refreshes both panes
  // a stray file dropped outside a pane must not navigate the window away
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('dragover', stop)
      window.removeEventListener('drop', stop)
    }
  }, [])

  useEffect(() => {
    void api.jobs.list().then(setJobs)
    const off = api.jobs.onUpdate((job) => {
      setJobs((prev) => {
        const old = prev.find((j) => j.id === job.id)
        const finished =
          old && old.state !== job.state && ['done', 'error', 'cancelled'].includes(job.state)
        if (finished) setTimeout(() => refreshRef.current(), 150)
        const next = prev.filter((j) => j.id !== job.id)
        return [...next, job].slice(-8)
      })
    })
    return off
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
        marks,
        chrome,
        ui
      })
    }, 500)
    return () => clearTimeout(t)
  }, [booted, panes, active, hidden, theme, sort, view, marks, ui])

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

  const reloadAll = () => {
    if (!panes) return
    void load(0, tabOf(panes[0]))
    void load(1, tabOf(panes[1]))
  }
  refreshRef.current = reloadAll

  const go = (i: number, dir: string) =>
    setPanes((p) => {
      if (!p) return p
      const s = p[i]
      const hist = [...s.hist.slice(0, s.hi + 1), dir]
      return patch(p, i, {
        tabs: s.tabs.map((t, j) => (j === s.ti ? dir : t)),
        sel: [],
        hist,
        hi: hist.length - 1,
        virtual: null,
        results: null
      })
    })

  const jump = (i: number, delta: number) =>
    setPanes((p) => {
      if (!p) return p
      const s = p[i]
      const hi = s.hi + delta
      if (hi < 0 || hi >= s.hist.length) return p
      return patch(p, i, {
        hi,
        tabs: s.tabs.map((t, j) => (j === s.ti ? s.hist[hi] : t)),
        sel: [],
        virtual: null,
        results: null
      })
    })

  const up = (i: number) => {
    const parent = panes?.[i].listing?.parent
    if (parent) go(i, parent)
  }

  const runSel = async (i: number, kind: 'copy' | 'move' | 'trash' | 'delete') => {
    if (!panes) return
    const me = panes[i]
    if (!me.sel.length) {
      setNote('چیزی انتخاب نشده')
      return
    }
    if (me.archive) {
      const dest = tabOf(panes[1 - i])
      const names = me.sel.map((p) => p.slice(me.archive!.length + 1))
      setNote('در حال استخراج…')
      const r = await api.extract(me.archive, names, dest)
      setNote(
        r.errors.length
          ? `استخراج: ${fa(r.done)} فایل، ${fa(r.errors.length)} خطا — ${r.errors[0]}`
          : `استخراج: ${fa(r.done)} فایل به ${baseName(dest)}`
      )
      setPanes((p) => p && patch(p, i, { sel: [] }))
      await load(1 - i, dest)
      return
    }
    if (kind === 'copy' || kind === 'move') {
      const dest = tabOf(panes[1 - i])
      await api.jobs.start(kind, me.sel, dest)
      setNote(`${OP_LABEL[kind]} ${fa(me.sel.length)} مورد آغاز شد`)
      setPanes((p) => p && patch(p, i, { sel: [] }))
      return
    }
    const res = await api.remove(me.sel, kind === 'delete')
    setNote(
      res.errors.length
        ? `${OP_LABEL[kind]}: ${fa(res.done)} انجام شد، ${fa(res.errors.length)} خطا — ${res.errors[0]}`
        : `${OP_LABEL[kind]}: ${fa(res.done)} مورد`
    )
    setPanes((p) => p && patch(p, i, { sel: [] }))
    reloadAll()
  }

  const doUndo = async () => {
    const r = await api.undo.run()
    setNote(r.done ? `بازگردانی شد: ${r.label} (${fa(r.done)})` : 'چیزی برای بازگردانی نیست')
    if (r.done) reloadAll()
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
    if (kind === 'rename' && !me.sel[0]) {
      setNote('چیزی انتخاب نشده')
      return
    }
    const res =
      kind === 'mkdir'
        ? await api.mkdir(tabOf(me), value)
        : await api.renameMany([{ from: me.sel[0], to: joinPath(dirOf(me.sel[0]), value) }])
    setNote(res.errors.length ? `خطا — ${res.errors[0]}` : `${kind === 'mkdir' ? 'پوشهٔ نو' : 'تغییر نام'}: ${value}`)
    await load(active, tabOf(me))
  }

  const openArchive = async (i: number, archive: string) => {
    setPanes((p) => p && patch(p, i, { loading: true }))
    const r = await api.archive(archive)
    setPanes((p) =>
      p &&
      patch(p, i, {
        virtual: { kind: 'archive', label: `${baseName(archive)} · ${fa(r.entries.length)}` },
        results: r.entries,
        archive,
        sel: [],
        loading: false
      })
    )
  }

  const openEntry = (i: number, p: string) => {
    const e =
      panes?.[i].listing?.entries.find((x) => x.path === p) ??
      panes?.[i].results?.find((x) => x.path === p)
    if (!e) return
    if (e.dir) go(i, e.path)
    else if (isArchiveName(e.name)) void openArchive(i, e.path)
    else void api.open(e.path)
  }

  const toggleMark = (i: number) => {
    const cur = panes?.[i] ? tabOf(panes[i]) : ''
    if (!cur) return
    setMarks((m) => (m.includes(cur) ? m.filter((x) => x !== cur) : [...m, cur]))
  }

  const setVirtual = (i: number, kind: 'flat' | 'search' | 'dupes', label: string, results: Entry[]) =>
    setPanes((p) => p && patch(p, i, { virtual: { kind, label }, results, sel: [], loading: false }))

  const runFlat = async (i: number) => {
    if (!panes) return
    setPanes((p) => p && patch(p, i, { loading: true }))
    const r = await api.walk(tabOf(panes[i]), { limit: 5000 })
    setVirtual(i, 'flat', `نمای تخت · ${fa(r.entries.length)}${r.capped ? '+' : ''}`, r.entries)
  }

  const runSearch = async (i: number, q: SearchQuery) => {
    if (!panes) return
    setPanes((p) => p && patch(p, i, { loading: true }))
    const r = await api.walk(tabOf(panes[i]), {
      query: q.query,
      content: q.content,
      regex: q.regex,
      limit: 5000
    })
    setVirtual(i, 'search', `جست‌وجو · ${fa(r.entries.length)}${r.capped ? '+' : ''}`, r.entries)
    if (r.capped) setNote('نتیجه به ۵۰۰۰ مورد بریده شد')
  }

  const runDupes = async (i: number) => {
    if (!panes) return
    setPanes((p) => p && patch(p, i, { loading: true }))
    setNote('در حال محاسبهٔ hash…')
    const r = await api.dupes(tabOf(panes[i]))
    const groups = new Set(r.entries.map((e) => e.group)).size
    setVirtual(i, 'dupes', `تکراری‌ها · ${fa(groups)} گروه`, r.entries)
    setNote(r.entries.length ? `${fa(r.entries.length)} فایل تکراری در ${fa(groups)} گروه` : 'فایل تکراری پیدا نشد')
  }

  const openFolderLook = async (i: number) => {
    if (!panes) return
    const me = panes[i]
    const source = me.virtual && me.results ? me.results : (me.listing?.entries ?? [])
    const picked = source.find((e) => e.path === me.sel[0])
    const dir = picked?.dir ? picked.path : tabOf(me)
    const meta = await api.getMeta(dir)
    setFolderLook({ dir, name: baseName(dir), meta })
  }

  const saveFolderLook = async (patch: FolderMeta) => {
    if (!folderLook) return
    const meta = await api.setMeta(folderLook.dir, patch)
    setFolderLook({ ...folderLook, meta })
    reloadAll()
  }

  const entryOf = (i: number, path: string | null) => {
    const me = panes?.[i]
    if (!me || !path) return undefined
    const source = me.virtual && me.results ? me.results : (me.listing?.entries ?? [])
    return source.find((e) => e.path === path)
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setNote('در حافظه کپی شد')
    } catch {
      setNote(text)
    }
  }

  const shaOf = async (paths: string[]) => {
    if (!paths.length) return
    setNote('محاسبهٔ SHA-256…')
    const r = await api.hash(paths, 'sha256')
    const ok = r.filter((x) => x.hash)
    if (!ok.length) {
      setNote('hash محاسبه نشد')
      return
    }
    setNote(
      paths.length === 1
        ? `SHA-256: ${ok[0].hash!.slice(0, 24)}…`
        : `${fa(ok.length)} فایل hash شد`
    )
    await copyText(
      paths.length === 1 ? ok[0].hash! : ok.map((x) => `${x.hash}  ${baseName(x.path)}`).join('\n')
    )
  }

  const dropInternal = async (paths: string[], dest: string, copy: boolean) => {
    if (!paths.length) return
    await api.jobs.start(copy ? 'copy' : 'move', paths, dest)
    setNote(`${copy ? 'کپی' : 'انتقال'} ${fa(paths.length)} مورد به ${baseName(dest)}`)
  }

  const dropFiles = async (files: File[], dest: string) => {
    const paths = files.map((f) => api.pathForFile(f)).filter((p) => typeof p === 'string' && p)
    if (!paths.length) return
    await api.jobs.start('copy', paths, dest)
    setNote(`کپی ${fa(paths.length)} مورد از بیرون`)
  }

  const togglePreview = () => {
    // opening the panel with something already selected must show it, not an empty pane
    if (!previewOn) setPreviewPath((cur) => cur ?? panes?.[active]?.sel[0] ?? null)
    setPreviewOn((o) => !o)
  }

  const addTab = (i: number, dir: string) =>
    setPanes((p) => p && patch(p, i, { tabs: [...p[i].tabs, dir], ti: p[i].tabs.length }))

  const pickMenu = (id: string) => {
    if (!menu || !panes) return
    const me = panes[active]
    const path = menu.path
    switch (id) {
      case 'open':
        if (path) openEntry(active, path)
        break
      case 'archive':
        if (path) void openArchive(active, path)
        break
      case 'copy':
        void runSel(active, 'copy')
        break
      case 'move':
        void runSel(active, 'move')
        break
      case 'rename':
        openRename(active)
        break
      case 'batch':
        if (me.sel.length > 1) setRenameTargets(me.sel)
        break
      case 'trash':
        void runSel(active, 'trash')
        break
      case 'delete':
        void runSel(active, 'delete')
        break
      case 'copyPath':
        if (path) void copyText(path)
        break
      case 'sha':
        void shaOf(me.sel.length ? me.sel : path ? [path] : [])
        break
      case 'size':
        void computeSizes(active)
        break
      case 'look':
        void openFolderLook(active)
        break
      case 'tabHere':
        if (path) addTab(active, path)
        break
      case 'tabNew':
        addTab(active, tabOf(me))
        break
      case 'preview':
        if (path) {
          setPreviewPath(path)
          setPreviewOn(true)
        }
        break
      case 'mkdir':
        setPrompt({ kind: 'mkdir', value: '' })
        break
      case 'refresh':
        void load(active, tabOf(me))
        break
      case 'flat':
        void runFlat(active)
        break
      case 'dupes':
        void runDupes(active)
        break
    }
  }

  const menuItems = (path: string | null): MenuItem[] => {
    const me = panes?.[active]
    if (!me) return []
    const entry = entryOf(active, path)
    if (!path) {
      return [
        { id: 'mkdir', label: 'پوشهٔ نو', key: 'F7', icon: <FolderPlusIcon /> },
        { id: 'refresh', label: 'نوسازی', key: 'F3', icon: <RefreshIcon /> },
        { sep: true },
        { id: 'flat', label: 'نمای تخت', icon: <LayersIcon /> },
        { id: 'dupes', label: 'فایل‌های تکراری', icon: <GaugeIcon /> },
        { id: 'size', label: 'اندازهٔ این پوشه', key: 'F9', icon: <GaugeIcon /> },
        { id: 'look', label: 'رنگ و آیکون این پوشه', icon: <PaletteIcon /> },
        { sep: true },
        { id: 'tabNew', label: 'تب نو', icon: <PlusIcon /> }
      ]
    }
    const items: MenuItem[] = [
      { id: 'open', label: entry?.dir ? 'باز کردن' : 'اجرا کردن', icon: <PlayIcon /> }
    ]
    if (entry && !entry.dir && isArchiveName(entry.name)) {
      items.push({ id: 'archive', label: 'مرور آرشیو', icon: <ArchiveOpenIcon /> })
    }
    items.push(
      { id: 'preview', label: 'پیش‌نمایش', icon: <PreviewIcon /> },
      { sep: true },
      { id: 'copy', label: 'کپی به پنجرهٔ مقابل', key: 'F5', icon: <CopyIcon /> },
      { id: 'move', label: 'انتقال به پنجرهٔ مقابل', key: 'F6', icon: <MoveIcon /> },
      { sep: true },
      { id: 'rename', label: 'تغییر نام', key: 'F2', icon: <RenameIcon /> }
    )
    if (me.sel.length > 1) {
      items.push({ id: 'batch', label: 'تغییر نام گروهی…', icon: <RenameIcon /> })
    }
    items.push(
      { id: 'trash', label: 'سطل بازیافت', key: 'F8', icon: <TrashIcon /> },
      { id: 'delete', label: 'حذف قطعی', key: 'Shift+F8', icon: <TrashIcon />, danger: true },
      { sep: true },
      { id: 'copyPath', label: 'کپی مسیر', icon: <CopyIcon /> },
      { id: 'sha', label: 'SHA-256', icon: <GaugeIcon /> }
    )
    if (entry?.dir) {
      items.push(
        { id: 'size', label: 'محاسبهٔ اندازه', key: 'F9', icon: <GaugeIcon /> },
        { id: 'look', label: 'رنگ و آیکون پوشه', icon: <PaletteIcon /> },
        { id: 'tabHere', label: 'تب نو در این پوشه', icon: <PlusIcon /> }
      )
    }
    return items
  }

  const exitVirtual = (i: number) =>
    setPanes((p) => p && patch(p, i, { virtual: null, results: null, archive: null, sel: [] }))

  const openRename = (i: number) => {
    if (!panes) return
    const sel = panes[i].sel
    if (sel.length > 1) setRenameTargets(sel)
    else if (sel.length === 1) setPrompt({ kind: 'rename', value: baseName(sel[0]) })
    else setNote('چیزی انتخاب نشده')
  }

  const visibleOf = (i: number) => {
    const pane = panes?.[i]
    if (!pane) return []
    const source = pane.virtual && pane.results ? pane.results : (pane.listing?.entries ?? [])
    return orderEntries(source, sort.key, sort.asc, pane.filter)
  }

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

      if (ev.ctrlKey && ev.shiftKey && (ev.key === 'F' || ev.key === 'f')) {
        ev.preventDefault()
        void runFlat(active)
        return
      }

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
          openRename(active)
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
        case 'z':
        case 'Z':
          if (ev.ctrlKey) {
            ev.preventDefault()
            void doUndo()
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
  const running = jobs.filter((j) => j.state === 'running' || j.state === 'paused').length

  return (
    <div className="app">
      {chrome.customTitlebar && <TitleBar note={note} />}
      <header className="topbar">
        {!chrome.customTitlebar && (
          <span className="brand">
            <span className="logo">
              <FolderIcon />
            </span>
            مدیر فایل مکس
          </span>
        )}
        <button
          className={'tb' + (ui.sidebarOpen ? ' on' : '')}
          title="سایدبار"
          onClick={() => setUi((u) => ({ ...u, sidebarOpen: !u.sidebarOpen }))}
        >
          <MenuIcon />
        </button>
        <button
          className={'tb' + (settingsOpen ? ' on' : '')}
          title="تنظیمات"
          onClick={() => setSettingsOpen((o) => !o)}
        >
          <SettingsIcon />
        </button>
        <span className="spacer" />
        {!chrome.customTitlebar && <span className="note">{note}</span>}
        <button
          className={'tb' + (previewOn ? ' on' : '')}
          title="پنل پیش‌نمایش"
          onClick={togglePreview}
        >
          <PreviewIcon />
        </button>
        <button className="tb" title="بازگردانی آخرین عملیات (Ctrl+Z)" onClick={() => void doUndo()}>
          <UndoIcon />
        </button>
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

      {settingsOpen && (
        <SettingsPanel
          chrome={chrome}
          ui={ui}
          theme={theme}
          onChrome={(c) => {
            setChrome(c)
            void api.window.setChrome(c)
          }}
          onUi={(p) => setUi((u) => ({ ...u, ...p }))}
          onTheme={setTheme}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <div className="body" onMouseDown={() => settingsOpen && setSettingsOpen(false)}>
        {ui.sidebarOpen && ui.sidebar === 'docked' && (
          <Sidebar
            roots={roots}
            marks={marks}
            activePath={curPath}
            onNav={(d) => go(active, d)}
            onUnmark={(m) => setMarks((x) => x.filter((y) => y !== m))}
          />
        )}

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
            onSel={(paths, mode) => {
              if (previewOn) setPreviewPath(paths[0] ?? null)
              setPanes((p) => {
                if (!p) return p
                if (mode === 'set') return patch(p, i, { sel: paths })
                const cur = p[i].sel
                const all = paths.every((x) => cur.includes(x))
                return patch(p, i, {
                  sel: all ? cur.filter((x) => !paths.includes(x)) : [...new Set([...cur, ...paths])]
                })
              })
            }}
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
              else if (kind === 'rename') openRename(i)
              else void runSel(i, kind)
            }}
            onSize={() => void computeSizes(i)}
            onBookmark={() => toggleMark(i)}
            onFlat={() => void runFlat(i)}
            onDupes={() => void runDupes(i)}
            onSearch={(q) => void runSearch(i, q)}
            onExitVirtual={() => exitVirtual(i)}
            onFolderLook={() => openFolderLook(i)}
            onContext={(path, x, y) => setMenu({ path, x, y })}
            onDropInternal={(paths, dest, copy) => void dropInternal(paths, dest, copy)}
            onDropFiles={(files, dest) => void dropFiles(files, dest)}
          />
        ))}

        {previewOn && (
          <PreviewPanel
            entry={entryOf(active, previewPath) ?? null}
            onOpen={(p) => void api.open(p)}
            onClose={() => setPreviewOn(false)}
          />
        )}

        {ui.sidebarOpen && ui.sidebar === 'float' && (
          <div className="side-float">
            <div className="side-float-panel">
              <Sidebar
                roots={roots}
                marks={marks}
                activePath={curPath}
                onNav={(d) => {
                  go(active, d)
                  setUi((u) => ({ ...u, sidebarOpen: false }))
                }}
                onUnmark={(m) => setMarks((x) => x.filter((y) => y !== m))}
              />
            </div>
            <div
              className="side-float-backdrop"
              onMouseDown={() => setUi((u) => ({ ...u, sidebarOpen: false }))}
            />
          </div>
        )}
      </div>

      <JobsBar
        jobs={jobs}
        onPause={(id) => void api.jobs.pause(id)}
        onResume={(id) => void api.jobs.resume(id)}
        onCancel={(id) => void api.jobs.cancel(id)}
        onClear={() => {
          void api.jobs.clear().then(() => api.jobs.list().then(setJobs))
        }}
      />

      <footer className="status">
        <span>
          {panes[active].virtual
            ? `${fa(visible.length)} نتیجه`
            : panes[active].listing
              ? `${fa(visible.length)} مورد`
              : panes[active].loading
                ? 'در حال خواندن…'
                : 'فهرستی نیست'}
        </span>
        <span>{panes[active].sel.length ? `${fa(panes[active].sel.length)} انتخاب‌شده` : ''}</span>
        <span>{running ? `${fa(running)} عملیات در جریان` : ''}</span>
        <span className="spacer" />
        <div className="status-actions">
          <button className="sbtn" title="کپی (F5)" onClick={() => void runSel(active, 'copy')}>
            <CopyIcon />
            <span>کپی</span>
          </button>
          <button className="sbtn" title="انتقال (F6)" onClick={() => void runSel(active, 'move')}>
            <MoveIcon />
            <span>انتقال</span>
          </button>
          <button className="sbtn" title="تغییر نام (F2)" onClick={() => openRename(active)}>
            <RenameIcon />
            <span>نام</span>
          </button>
          <button className="sbtn" title="پوشهٔ نو (F7)" onClick={() => setPrompt({ kind: 'mkdir', value: '' })}>
            <FolderPlusIcon />
            <span>پوشه</span>
          </button>
          <button className="sbtn" title="سطل بازیافت (F8)" onClick={() => void runSel(active, 'trash')}>
            <TrashIcon />
            <span>سطل</span>
          </button>
          <button className="sbtn" title="اندازهٔ پوشه (F9)" onClick={() => void computeSizes(active)}>
            <GaugeIcon />
            <span>اندازه</span>
          </button>
          <button className="sbtn" title="بازگردانی (Ctrl+Z)" onClick={() => void doUndo()}>
            <UndoIcon />
            <span>بازگردانی</span>
          </button>
        </div>
      </footer>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.path)}
          onPick={pickMenu}
          onClose={() => setMenu(null)}
        />
      )}

      {folderLook && (
        <FolderDialog
          dir={folderLook.dir}
          name={folderLook.name}
          meta={folderLook.meta}
          iconDirs={ui.iconDirs ?? []}
          onSave={(patch) => void saveFolderLook(patch)}
          onAddIconDir={(dir) => setUi((u) => ({ ...u, iconDirs: [...(u.iconDirs ?? []), dir] }))}
          onClose={() => setFolderLook(null)}
        />
      )}

      {renameTargets && (
        <RenameDialog
          paths={renameTargets}
          onClose={() => setRenameTargets(null)}
          onApply={async (pairs) => {
            setRenameTargets(null)
            const res = await api.renameMany(pairs)
            setNote(
              res.errors.length
                ? `${fa(res.done)} تغییر نام، ${fa(res.errors.length)} خطا — ${res.errors[0]}`
                : `${fa(res.done)} تغییر نام انجام شد`
            )
            reloadAll()
          }}
        />
      )}

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
