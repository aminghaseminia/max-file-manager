import { BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import dbus, { Variant, interface as dbusInterface, type MessageBus } from 'dbus-next'
import { fileUri, portalPath, type PortalFilter, type PortalFilterRule } from './portal-core.ts'
import { PORTAL_BUS_NAME } from './portal-install.ts'

export type PortalOperation = 'open' | 'save' | 'saveFiles'
export type PortalRequestData = {
  id: string
  operation: PortalOperation
  title: string
  multiple: boolean
  directory: boolean
  currentFolder: string | null
  currentName: string
  acceptLabel: string
  filters: PortalFilter[]
  fileNames: string[]
}

type PortalResult = { paths: string[]; filter?: PortalFilter | null }
type ResponseBody = [number, Record<string, Variant>]
type Pending = {
  data: PortalRequestData
  handle: string
  requestIface: PortalRequest
  resolve(body: ResponseBody): void
  window: BrowserWindow | null
  settled: boolean
}

const bool = (options: Record<string, Variant>, key: string): boolean => options[key]?.value === true
const str = (options: Record<string, Variant>, key: string): string => {
  const value = options[key]?.value
  return typeof value === 'string' ? value : ''
}

function filtersOf(value: unknown): PortalFilter[] {
  if (!Array.isArray(value)) return []
  const out: PortalFilter[] = []
  for (const item of value.slice(0, 50)) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || !Array.isArray(item[1])) continue
    const rules: PortalFilterRule[] = []
    for (const rule of item[1].slice(0, 100)) {
      if (Array.isArray(rule) && typeof rule[0] === 'number' && typeof rule[1] === 'string') {
        rules.push([rule[0], rule[1]])
      }
    }
    out.push({ name: item[0].slice(0, 200) || 'Files', rules })
  }
  return out
}

function namesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, 500)
    .map((v) => portalPath(v))
    .filter((v): v is string => !!v)
    .map((v) => path.basename(v))
    .filter(Boolean)
}

function requestData(operation: PortalOperation, title: string, options: Record<string, Variant>): PortalRequestData {
  const currentFile = portalPath(options['current_file']?.value)
  return {
    id: randomUUID(),
    operation,
    title: title || (operation === 'open' ? 'Open' : 'Save'),
    multiple: operation === 'saveFiles' || bool(options, 'multiple'),
    directory: operation === 'saveFiles' || bool(options, 'directory'),
    currentFolder: portalPath(options['current_folder']?.value) ?? (currentFile ? path.dirname(currentFile) : null),
    currentName: str(options, 'current_name') || (currentFile ? path.basename(currentFile) : ''),
    acceptLabel: str(options, 'accept_label'),
    filters: filtersOf(options['filters']?.value),
    fileNames: operation === 'saveFiles' ? namesOf(options['files']?.value) : []
  }
}

class PortalRequest extends dbusInterface.Interface {
  constructor(
    readonly handle: string,
    private readonly onClose: () => void
  ) {
    super('org.freedesktop.impl.portal.Request')
  }

  Close(): void {
    this.onClose()
  }
}
PortalRequest.configureMembers({ methods: { Close: { inSignature: '', outSignature: '' } } })

type ServerOptions = {
  preload: string
  rendererUrl?: string
  rendererFile: string
  icon?: string
}

/** The backend side of org.freedesktop.impl.portal.FileChooser. */
export class PortalServer {
  private bus: MessageBus | null = null
  private starting: Promise<void> | null = null
  private pending = new Map<string, Pending>()
  private byWebContents = new Map<number, Pending>()

  constructor(private readonly options: ServerOptions) {}

  get running(): boolean {
    return this.bus !== null
  }

  async start(): Promise<void> {
    if (this.bus || process.platform !== 'linux') return
    if (this.starting) return this.starting
    this.starting = this.startBus()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  private async startBus(): Promise<void> {
    const bus = dbus.sessionBus()
    bus.on('error', () => undefined) // a disappearing session bus must not crash the file manager
    const server = this
    class FileChooser extends dbusInterface.Interface {
      constructor() {
        super('org.freedesktop.impl.portal.FileChooser')
      }
      OpenFile(handle: string, _appId: string, _parent: string, title: string, options: Record<string, Variant>) {
        return server.pick(bus, handle, requestData('open', title, options))
      }
      SaveFile(handle: string, _appId: string, _parent: string, title: string, options: Record<string, Variant>) {
        return server.pick(bus, handle, requestData('save', title, options))
      }
      SaveFiles(handle: string, _appId: string, _parent: string, title: string, options: Record<string, Variant>) {
        return server.pick(bus, handle, requestData('saveFiles', title, options))
      }
    }
    FileChooser.configureMembers({
      methods: {
        OpenFile: { inSignature: 'osssa{sv}', outSignature: 'ua{sv}' },
        SaveFile: { inSignature: 'osssa{sv}', outSignature: 'ua{sv}' },
        SaveFiles: { inSignature: 'osssa{sv}', outSignature: 'ua{sv}' }
      }
    })
    // Export before owning the name: D-Bus activation completes on name acquisition, and the
    // frontend's first OpenFile arrives immediately — a call before export fails with
    // "Method OpenFile ... does not exist".
    const chooser = new FileChooser()
    bus.export('/org/freedesktop/portal/desktop', chooser)
    const owner = await bus.requestName(PORTAL_BUS_NAME, dbus.NameFlag.DO_NOT_QUEUE)
    if (owner !== dbus.RequestNameReply.PRIMARY_OWNER && owner !== dbus.RequestNameReply.ALREADY_OWNER) {
      bus.unexport('/org/freedesktop/portal/desktop', chooser)
      bus.disconnect()
      throw new Error('The MFM file-picker D-Bus name is already owned')
    }
    this.bus = bus
  }

  private pick(bus: MessageBus, handle: string, data: PortalRequestData): Promise<ResponseBody> {
    return new Promise<ResponseBody>((resolve) => {
      let requestIface: PortalRequest
      const pending: Pending = {
        data,
        handle,
        requestIface: undefined as unknown as PortalRequest,
        resolve,
        window: null,
        settled: false
      }
      requestIface = new PortalRequest(handle, () => {
        this.cancel(handle)
      })
      pending.requestIface = requestIface
      this.pending.set(handle, pending)
      bus.export(handle, requestIface)

      const win = new BrowserWindow({
        title: data.title,
        width: 960,
        height: 640,
        minWidth: 680,
        minHeight: 440,
        show: false,
        icon: this.options.icon,
        autoHideMenuBar: true,
        backgroundColor: '#16181d',
        webPreferences: {
          preload: this.options.preload,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      })
      pending.window = win
      const webContentsId = win.webContents.id
      this.byWebContents.set(webContentsId, pending)
      win.once('ready-to-show', () => {
        if (!pending.settled && !win.isDestroyed()) {
          win.show()
          win.focus()
        }
      })
      win.once('closed', () => {
        this.byWebContents.delete(webContentsId)
        this.settle(pending, [1, {}])
      })
      if (this.options.rendererUrl) {
        const url = new URL(this.options.rendererUrl)
        url.searchParams.set('portal', '1')
        void win.loadURL(url.toString())
      } else void win.loadFile(this.options.rendererFile, { query: { portal: '1' } })
    })
  }

  requestFor(webContentsId: number): PortalRequestData | null {
    return this.byWebContents.get(webContentsId)?.data ?? null
  }

  async respond(webContentsId: number, result: PortalResult | null): Promise<{ ok: true } | { error: string }> {
    const pending = this.byWebContents.get(webContentsId)
    if (!pending || pending.settled) return { error: 'This file-picker request is no longer active' }
    if (!result) {
      this.settle(pending, [1, {}])
      return { ok: true }
    }
    const paths = [...new Set(result.paths ?? [])].filter((p) => typeof p === 'string' && path.isAbsolute(p)).slice(0, 500)
    if (!paths.length) return { error: 'Select a file first' }
    if (!pending.data.multiple && paths.length !== 1) return { error: 'Select only one file' }

    if (pending.data.operation === 'open') {
      for (const p of paths) {
        const st = await fs.stat(p).catch(() => null)
        if (!st) return { error: `Not found: ${p}` }
        if (pending.data.directory !== st.isDirectory()) return { error: pending.data.directory ? 'Select a folder' : 'Select a file' }
      }
    }
    const results: Record<string, Variant> = { uris: new Variant('as', paths.map(fileUri)) }
    if (result.filter) results['current_filter'] = new Variant('(sa(us))', [result.filter.name, result.filter.rules])
    this.settle(pending, [0, results])
    return { ok: true }
  }

  private cancel(handle: string): void {
    const pending = this.pending.get(handle)
    if (pending) this.settle(pending, [1, {}])
  }

  private settle(pending: Pending, body: ResponseBody): void {
    if (pending.settled) return
    pending.settled = true
    this.pending.delete(pending.handle)
    if (this.bus) this.bus.unexport(pending.handle, pending.requestIface)
    pending.resolve(body)
    const win = pending.window
    // Let the method reply reach the bus before the last window closes: in the headless
    // (D-Bus activated) process, destroying it first would fire window-all-closed and quit
    // mid-reply, and the caller would see an error instead of the chosen file.
    if (win && !win.isDestroyed()) setTimeout(() => win.isDestroyed() || win.destroy(), 80)
  }

  stop(): void {
    for (const pending of [...this.pending.values()]) this.settle(pending, [1, {}])
    const bus = this.bus
    this.bus = null
    if (bus) {
      void bus.releaseName(PORTAL_BUS_NAME).catch(() => undefined)
      bus.disconnect()
    }
  }
}
