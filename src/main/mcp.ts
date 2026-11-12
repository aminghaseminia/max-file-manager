import { app, shell } from 'electron'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { promises as fs } from 'node:fs'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import path from 'node:path'

/**
 * Loopback API + stdio bridge, per docs/MCP.md: off by default, token required, read-only unless
 * the user switches mode, and every call appended to an audit log.
 */
export type McpMode = 'off' | 'read' | 'write'
export type McpConfig = { mode: McpMode; port: number; token: string }

export type McpTool = {
  name: string
  description: string
  /** false = needs read-write mode */
  read: boolean
  input: Record<string, string>
}

const TOOLS: McpTool[] = [
  // ── look around ────────────────────────────────────────────────────────────
  { name: 'roots', description: 'home folder and mounted drives', read: true, input: {} },
  { name: 'drives_list', description: 'connected USB and removable block devices and their mount points', read: true, input: {} },
  { name: 'list', description: 'entries of a folder with metadata, labels, ratings and notes', read: true, input: { path: 'string', hidden: 'boolean?', dims: 'boolean?' } },
  { name: 'dirs', description: 'sub-folders only', read: true, input: { path: 'string', hidden: 'boolean?' } },
  { name: 'walk', description: 'recursive list with name/content filters', read: true, input: { dir: 'string', pattern: 'string?', regex: 'boolean?', content: 'string?', hidden: 'boolean?', exclude: 'string[]?', maxDepth: 'number?', cap: 'number?' } },
  { name: 'properties', description: 'name, size, mode, owner, links, timestamps, image size', read: true, input: { path: 'string' } },
  { name: 'statfs', description: 'free and total bytes of a filesystem', read: true, input: { path: 'string' } },
  { name: 'size', description: 'recursive size of a folder', read: true, input: { path: 'string' } },
  { name: 'hash', description: 'digest of files', read: true, input: { paths: 'string[]', algo: 'string?' } },
  { name: 'dupes', description: 'duplicate files under a folder (by content hash)', read: true, input: { dir: 'string' } },

  // ── the search index ───────────────────────────────────────────────────────
  { name: 'search', description: 'query the indexed filename database', read: true, input: { query: 'string', limit: 'number?' } },
  { name: 'search_stats', description: 'index size, roots and last index time', read: true, input: {} },
  { name: 'search_status', description: 'is indexing running; scanned, added, folder progress and errors', read: true, input: {} },
  { name: 'search_sizes', description: 'folder sizes straight from the index', read: true, input: { dirs: 'string[]' } },

  // ── contents ───────────────────────────────────────────────────────────────
  { name: 'preview', description: 'preview payload for a file (text, image, audio, office)', read: true, input: { path: 'string', maxKB: 'number?' } },
  { name: 'read_text', description: 'file text up to 8 MB', read: true, input: { path: 'string' } },
  { name: 'archive_list', description: 'entries inside a zip/tar archive', read: true, input: { path: 'string' } },
  { name: 'diff', description: 'line diff of two text files', read: true, input: { a: 'string', b: 'string' } },
  { name: 'sync_compare', description: 'compare two trees for synchronisation', read: true, input: { left: 'string', right: 'string', deep: 'boolean?', compareBy: 'string?', ignore: 'string[]?' } },
  { name: 'tags', description: 'audio/EXIF tags of files', read: true, input: { paths: 'string[]' } },

  // ── per-folder metadata (.mfm.json) ────────────────────────────────────────
  { name: 'meta_get', description: 'labels, file colours, pins, ratings, notes and format of a folder', read: true, input: { dir: 'string' } },
  { name: 'labels', description: 'the colour-label palette (id, name, colour)', read: true, input: {} },
  { name: 'folder_look', description: 'the colour/icon a folder displays (app metadata or Dolphin/Windows)', read: true, input: { path: 'string' } },
  { name: 'icons', description: 'icon themes, or the icon names inside one theme', read: true, input: { theme: 'string?', extra: 'string[]?' } },

  // ── transfers and undo ─────────────────────────────────────────────────────
  { name: 'jobs_list', description: 'transfer jobs and progress', read: true, input: {} },
  { name: 'undo_depth', description: 'how many transfers can still be undone', read: true, input: {} },

  // ── window and preferences ─────────────────────────────────────────────────
  { name: 'state', description: 'panes, tabs and preferences of the window', read: true, input: {} },
  { name: 'mcp_status', description: 'MCP mode, port and recent audit log', read: true, input: {} },

  // ── applications and desktop ───────────────────────────────────────────────
  { name: 'apps', description: 'applications that can open a file', read: true, input: { path: 'string' } },
  { name: 'app_default', description: 'the default application for a file type', read: true, input: { path: 'string' } },
  { name: 'desktop_default_manager', description: 'is this app the system default file manager', read: true, input: {} },
  { name: 'update_check', description: 'compare the running version with the latest release', read: true, input: { force: 'boolean?' } },

  // ── writing files ──────────────────────────────────────────────────────────
  { name: 'write_text', description: 'write a text file atomically', read: false, input: { path: 'string', text: 'string' } },
  { name: 'mkdir', description: 'create a folder', read: false, input: { dir: 'string', name: 'string' } },
  { name: 'rename', description: 'rename one file (never overwrites)', read: false, input: { path: 'string', name: 'string' } },
  { name: 'rename_many', description: 'rename many files in one batch', read: false, input: { pairs: 'object[]' } },
  { name: 'copy', description: 'queue a copy into a folder', read: false, input: { paths: 'string[]', dest: 'string', skipExisting: 'boolean?', newerOnly: 'boolean?', limitBps: 'number?' } },
  { name: 'move', description: 'queue a move into a folder', read: false, input: { paths: 'string[]', dest: 'string', skipExisting: 'boolean?', newerOnly: 'boolean?', limitBps: 'number?' } },
  { name: 'trash', description: 'send to the system trash', read: false, input: { paths: 'string[]' } },
  { name: 'delete', description: 'permanent delete, needs confirm:true', read: false, input: { paths: 'string[]', confirm: 'boolean' } },
  { name: 'symlink', description: 'create a symbolic link', read: false, input: { target: 'string', link: 'string' } },
  { name: 'chmod', description: 'change permission bits of a path', read: false, input: { path: 'string', mode: 'number' } },
  { name: 'extract', description: 'extract an archive (never overwrites)', read: false, input: { archive: 'string', dest: 'string', names: 'string[]?' } },
  { name: 'create_zip', description: 'zip files into a folder', read: false, input: { dir: 'string', name: 'string', sources: 'string[]', level: 'number?' } },
  { name: 'tags_write', description: 'write ID3 tags of an audio file', read: false, input: { path: 'string', fields: 'object' } },
  { name: 'export_listing', description: 'write a folder listing as CSV or PDF', read: false, input: { dir: 'string', name: 'string', rows: 'object[]', format: 'string', theme: 'string?' } },
  { name: 'pdf', description: 'render HTML to a PDF file', read: false, input: { html: 'string', out: 'string', theme: 'string?' } },

  // ── images ─────────────────────────────────────────────────────────────────
  { name: 'image_get', description: 'a file as a data URL (max 40 MB)', read: true, input: { path: 'string' } },
  { name: 'image_save', description: 'save an edited image over the original or as a copy', read: false, input: { src: 'string', dataUrl: 'string', mode: 'string' } },
  { name: 'image_save_as', description: 'save an edited image beside the original', read: false, input: { src: 'string', dataUrl: 'string' } },
  { name: 'image_convert', description: 'batch-convert images to another format', read: false, input: { files: 'string[]', format: 'string', maxSide: 'number?', quality: 'number?', dest: 'string?' } },
  { name: 'clipboard_image', description: 'save clipboard image bytes (base64) into a folder', read: false, input: { dir: 'string', name: 'string', base64: 'string' } },
  { name: 'thumbs_clear', description: 'empty the thumbnail cache', read: false, input: {} },

  // ── tags, colours, ratings, pins, layout ───────────────────────────────────
  { name: 'label_set', description: 'set or clear a colour label/tag on a file', read: false, input: { dir: 'string', name: 'string', label: 'string|null' } },
  { name: 'file_color_set', description: 'set or clear the colour dot of a file', read: false, input: { dir: 'string', name: 'string', color: 'string' } },
  { name: 'rating_set', description: 'set 0..5 stars on a file', read: false, input: { dir: 'string', name: 'string', stars: 'number' } },
  { name: 'note_set', description: 'write the per-file note stored in the folder', read: false, input: { dir: 'string', name: 'string', text: 'string' } },
  { name: 'meta_set', description: 'change a folder colour/icon/labels/notes/pins', read: false, input: { dir: 'string', patch: 'object' } },
  { name: 'sort_set', description: 'remember a folder sort key and direction', read: false, input: { dir: 'string', key: 'string', asc: 'boolean?' } },
  { name: 'pin_set', description: 'pin or unpin a file in its folder', read: false, input: { dir: 'string', name: 'string', on: 'boolean' } },

  // ── jobs, index and settings ───────────────────────────────────────────────
  { name: 'job_start', description: 'start a transfer job', read: false, input: { kind: 'string', sources: 'string[]', dest: 'string', opts: 'object?' } },
  { name: 'job_pause', description: 'pause a transfer job', read: false, input: { id: 'string' } },
  { name: 'job_resume', description: 'resume a transfer job', read: false, input: { id: 'string' } },
  { name: 'job_cancel', description: 'cancel a transfer job', read: false, input: { id: 'string' } },
  { name: 'job_clear', description: 'clear finished jobs from the bar', read: false, input: {} },
  { name: 'undo', description: 'undo the last transfer', read: false, input: {} },
  { name: 'sync_apply', description: 'apply a synchronisation plan (deletes go to trash)', read: false, input: { left: 'string', right: 'string', rows: 'object[]', mode: 'string', deleteExtra: 'boolean?' } },
  { name: 'run_script', description: 'run the user\'s script with {path}/{dir} substituted', read: false, input: { command: 'string', path: 'string?', dir: 'string?' } },
  { name: 'run_custom_command', description: 'run a custom command in background with %f/{path} substituted', read: false, input: { command: 'string', path: 'string' } },
  { name: 'search_index', description: 'index folders; wait:false returns at once, then poll search_status', read: false, input: { roots: 'string[]', exclude: 'string[]?', wait: 'boolean?' } },
  { name: 'search_clear', description: 'empty the search index (settings are kept)', read: false, input: {} },
  { name: 'prefs_set', description: 'change preferences; everything is written to SQLite', read: false, input: { patch: 'object' } },
  { name: 'settings_export', description: 'write every preference to a JSON file', read: false, input: { path: 'string?' } },
  { name: 'settings_import', description: 'load preferences from a JSON file and apply them', read: false, input: { path: 'string?', apply: 'boolean?' } },

  // ── system hand-off ────────────────────────────────────────────────────────
  { name: 'open', description: 'open a file or folder in its default application', read: false, input: { path: 'string' } },
  { name: 'reveal', description: 'show a file in the system file manager', read: false, input: { path: 'string' } },
  { name: 'terminal', description: 'open a terminal in a folder', read: false, input: { dir: 'string' } },
  { name: 'apps_launch', description: 'open a file with a chosen application', read: false, input: { id: 'string', path: 'string' } },
  { name: 'set_default_manager', description: 'register this app as the system default file manager', read: false, input: {} },
  { name: 'update_open', description: 'open the release page of a newer version', read: false, input: { url: 'string' } },
  { name: 'hotkey', description: 'register the global shortcut', read: false, input: { accel: 'string' } },
  { name: 'drive_mount', description: 'mount a removable block device (e.g. /dev/sdb1)', read: false, input: { device: 'string' } },
  { name: 'drive_unmount', description: 'unmount a removable block device or mount point', read: false, input: { device: 'string' } },

  // ── driving the window itself ──────────────────────────────────────────────
  { name: 'command', description: 'run any UI command by id (see commands list in the app)', read: false, input: { id: 'string', pane: 'number?' } },
  { name: 'goto', description: 'navigate a pane to a folder', read: false, input: { path: 'string', pane: 'number?' } },
  { name: 'select', description: 'select files in a pane', read: false, input: { paths: 'string[]', pane: 'number?' } },
  { name: 'filter', description: 'set the name filter of a pane', read: false, input: { text: 'string', pane: 'number?' } },
  { name: 'tab', description: "tab actions: new, close, next, prev, reopen, select, rename, lock, color", read: false, input: { action: 'string', pane: 'number?', path: 'string?', name: 'string?', color: 'string?', on: 'boolean?' } },
  { name: 'bookmark', description: 'add, remove or list bookmarked folders', read: false, input: { action: 'string', path: 'string?' } },
  { name: 'open_editor', description: 'open a text file in the built-in editor', read: false, input: { path: 'string' } },
  { name: 'open_gallery', description: 'open the image gallery', read: false, input: { path: 'string?', pane: 'number?' } },
  { name: 'open_preview', description: 'show or hide the side preview panel', read: false, input: { on: 'boolean', path: 'string?' } },
  { name: 'properties_dialog', description: 'open the properties dialog for a path', read: false, input: { path: 'string' } },
  { name: 'note', description: 'write a message in the status bar', read: false, input: { text: 'string' } },
  { name: 'window', description: 'window actions: minimize, maximize, close, show, fullscreen, chrome', read: false, input: { action: 'string', on: 'boolean?' } }
]


export const mcpTools = () => TOOLS

export function mcpFile(): string {
  return path.join(app.getPath('userData'), 'mcp.json')
}
export function mcpLogFile(): string {
  return path.join(app.getPath('userData'), 'mcp.log')
}

export async function readMcpConfig(): Promise<McpConfig> {
  const raw = await fs.readFile(mcpFile(), 'utf8').catch(() => '')
  try {
    const c = JSON.parse(raw)
    const mode: McpMode = c?.mode === 'write' ? 'write' : c?.mode === 'read' ? 'read' : 'off'
    const port = Number(c?.port) > 1024 && Number(c?.port) < 65535 ? Number(c.port) : 47321
    const token = typeof c?.token === 'string' ? c.token : ''
    return { mode, port, token }
  } catch {
    return { mode: 'off', port: 47321, token: '' }
  }
}

export async function writeMcpConfig(cfg: McpConfig): Promise<McpConfig> {
  const next: McpConfig = {
    mode: cfg.mode,
    port: cfg.port,
    token: cfg.token || randomBytes(24).toString('hex')
  }
  const file = mcpFile()
  await fs.mkdir(path.dirname(file), { recursive: true }).catch(() => {})
  await fs.writeFile(file, JSON.stringify(next, null, 2), { mode: 0o600 })
  await fs.chmod(file, 0o600).catch(() => {})
  return next
}

/** The tool implementations are injected by the main process, which owns the IPC surface. */
export type McpHandler = (tool: string, args: Record<string, unknown>) => Promise<unknown>

let server: Server | null = null

const sameToken = (a: string, b: string): boolean => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

async function audit(line: Record<string, unknown>): Promise<void> {
  const row = JSON.stringify({ ts: new Date().toISOString(), ...line }) + '\n'
  await fs.appendFile(mcpLogFile(), row, { mode: 0o600 }).catch(() => {})
}

/** Record a failed start (busy port, bad bind) in the same audit log the UI shows. */
export async function logMcpError(reason: string): Promise<void> {
  await audit({ tool: 'start', ok: false, reason })
}

export async function mcpLogTail(n = 50): Promise<string[]> {
  const raw = await fs.readFile(mcpLogFile(), 'utf8').catch(() => '')
  return raw.trim().split('\n').filter(Boolean).slice(-n)
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  const text = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

/** Starts (or restarts) the loopback server if the mode is not off. */
export async function startMcp(handler: McpHandler): Promise<{ running: boolean; port: number; mode: McpMode }> {
  await stopMcp()
  const cfg = await readMcpConfig()
  if (cfg.mode === 'off') return { running: false, port: cfg.port, mode: 'off' }

  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // loopback only: reject anything that looks like a browser or a proxied request
    if (req.headers.origin) return json(res, 403, { error: 'origin not allowed' })
    const host = req.headers.host ?? ''
    if (host !== `127.0.0.1:${cfg.port}` && host !== `localhost:${cfg.port}`) {
      return json(res, 403, { error: 'host not allowed' })
    }
    const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    if (!cfg.token || !sameToken(auth, cfg.token)) {
      await audit({ tool: 'auth', ok: false })
      return json(res, 401, { error: 'bad token' })
    }
    if (req.method === 'GET' && req.url === '/tools') return json(res, 200, { tools: TOOLS })
    if (req.method !== 'POST' || req.url !== '/call') return json(res, 404, { error: 'not found' })

    const body = await readBody(req)
    let payload: { tool?: string; args?: Record<string, unknown> } = {}
    try {
      payload = JSON.parse(body || '{}')
    } catch {
      return json(res, 400, { error: 'bad json' })
    }
    const tool = String(payload.tool ?? '')
    const meta = TOOLS.find((t) => t.name === tool)
    if (!meta) {
      await audit({ tool, ok: false, reason: 'unknown' })
      return json(res, 404, { error: `unknown tool ${tool}` })
    }
    if (!meta.read && cfg.mode !== 'write') {
      await audit({ tool, ok: false, reason: 'read-only' })
      return json(res, 403, { error: 'read-only mode: enable read-write in Preferences → ایجنتها' })
    }
    try {
      const result = await handler(tool, payload.args ?? {})
      await audit({ tool, ok: true, args: summarise(payload.args) })
      return json(res, 200, { result })
    } catch (e: any) {
      await audit({ tool, ok: false, reason: String(e?.message ?? e) })
      return json(res, 500, { error: String(e?.message ?? e) })
    }
  })

  await new Promise<void>((resolve, reject) => {
    const s = server!
    const onError = (e: Error) => {
      server = null
      reject(e)
    }
    s.once('error', onError)
    s.listen(cfg.port, '127.0.0.1', () => {
      s.off('error', onError)
      resolve()
    })
  })
  return { running: true, port: cfg.port, mode: cfg.mode }
}

export async function stopMcp(): Promise<void> {
  if (!server) return
  const s = server
  server = null
  await new Promise<void>((resolve) => s.close(() => resolve()))
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 4 * 1024 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

/** Only shapes and sizes go into the log, never file contents. */
function summarise(args: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (k === 'text') out.text = `<${String(v).length} chars>`
    else if (Array.isArray(v)) out[k] = `[${v.length}]`
    else if (typeof v === 'string') out[k] = v.slice(0, 160)
    else out[k] = v
  }
  return out
}

export const openReveal = (p: string) => shell.showItemInFolder(p)
