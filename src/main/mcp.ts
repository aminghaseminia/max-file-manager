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
  { name: 'roots', description: 'drives and home folder', read: true, input: {} },
  { name: 'list', description: 'entries of a folder', read: true, input: { path: 'string', hidden: 'boolean?' } },
  { name: 'dirs', description: 'sub-folders only', read: true, input: { path: 'string' } },
  { name: 'search', description: 'the indexed search database', read: true, input: { query: 'string', limit: 'number?' } },
  { name: 'preview', description: 'preview payload for a file', read: true, input: { path: 'string', maxKB: 'number?' } },
  { name: 'read_text', description: 'file text up to 8 MB', read: true, input: { path: 'string' } },
  { name: 'archive_list', description: 'entries inside an archive', read: true, input: { path: 'string' } },
  { name: 'meta_get', description: 'labels, pins, ratings, notes, format of a folder', read: true, input: { dir: 'string' } },
  { name: 'hash', description: 'digest of files', read: true, input: { paths: 'string[]', algo: 'string?' } },
  { name: 'jobs_list', description: 'transfer jobs and progress', read: true, input: {} },
  { name: 'state', description: 'panes, tabs and preferences of the window', read: true, input: {} },
  { name: 'write_text', description: 'write a text file atomically', read: false, input: { path: 'string', text: 'string' } },
  { name: 'mkdir', description: 'create a folder', read: false, input: { dir: 'string', name: 'string' } },
  { name: 'rename', description: 'rename one file (never overwrites)', read: false, input: { path: 'string', name: 'string' } },
  { name: 'copy', description: 'queue a copy into a folder', read: false, input: { paths: 'string[]', dest: 'string' } },
  { name: 'move', description: 'queue a move into a folder', read: false, input: { paths: 'string[]', dest: 'string' } },
  { name: 'trash', description: 'send to the system trash', read: false, input: { paths: 'string[]' } },
  { name: 'delete', description: 'permanent delete, needs confirm:true', read: false, input: { paths: 'string[]', confirm: 'boolean' } },
  { name: 'extract', description: 'extract an archive', read: false, input: { archive: 'string', dest: 'string', names: 'string[]?' } },
  { name: 'create_zip', description: 'zip files into a folder', read: false, input: { dir: 'string', name: 'string', sources: 'string[]', level: 'number?' } },
  { name: 'label_set', description: 'set or clear a colour label', read: false, input: { dir: 'string', name: 'string', label: 'string|null' } },
  { name: 'pin_set', description: 'pin or unpin a file in its folder', read: false, input: { dir: 'string', name: 'string', on: 'boolean' } },
  { name: 'note', description: 'write a message in the status bar', read: false, input: { text: 'string' } },
  { name: 'goto', description: 'navigate a pane', read: false, input: { pane: 'number?', path: 'string' } }
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

  await new Promise<void>((resolve) => server!.listen(cfg.port, '127.0.0.1', () => resolve()))
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
