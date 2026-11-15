import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { PassThrough, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { Client, FileType, FTPError, type FileInfo } from 'basic-ftp'

/**
 * FTP and FTPS through `basic-ftp`, with a small connection pool: one control connection per
 * (host, port, user, password, TLS) tuple, operations serialised, and a fresh connection after
 * an error. Transfers use a PassThrough/generator so pause and cancel work mid-file, not only
 * between files.
 *
 * Paths are absolute and are never interpolated into raw protocol commands here; the library
 * handles quoting/encoding. `remote-core` still rejects control characters before they arrive.
 */
export type FtpConfig = {
  host: string
  port: number
  user: string
  password: string
  secure: 'none' | 'explicit' | 'implicit'
  /** false accepts a self-signed certificate; the user opts in per profile */
  verifyTls: boolean
}

export type FtpControl = {
  onBytes?: (n: number) => void
  cancelled?: () => boolean
  paused?: () => boolean
  waitIfPaused?: () => Promise<void>
}

export type FtpEntry = {
  name: string
  dir: boolean
  size: number
  mtime: number
  link: boolean
}

export class FtpError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message || `FTP error ${code}`)
    this.name = 'FtpError'
    this.code = code
  }
}

type PoolEntry = {
  client: Client | null
  connected: boolean
  chain: Promise<unknown>
  idle: ReturnType<typeof setTimeout> | null
}

const pools = new Map<string, PoolEntry>()

function poolKey(cfg: FtpConfig): string {
  return [cfg.host, cfg.port, cfg.user, cfg.password, cfg.secure, cfg.verifyTls].join('\u0000')
}

function makeClient(): Client {
  return new Client(30_000)
}

function accessOptions(cfg: FtpConfig) {
  return {
    host: cfg.host,
    port: cfg.port,
    user: cfg.user || 'anonymous',
    password: cfg.password || 'guest',
    secure: cfg.secure === 'implicit' ? ('implicit' as const) : cfg.secure === 'explicit' ? true : false,
    secureOptions: { rejectUnauthorized: cfg.verifyTls !== false }
  }
}

const isCancelled = (control?: FtpControl): boolean => control?.cancelled?.() === true

function mapError(e: unknown): Error {
  if (e instanceof FTPError) {
    const message =
      e.code === 530
        ? 'the server rejected the username or password'
        : e.code === 550
          ? 'the file or folder does not exist, or access was refused'
          : e.message
    return new FtpError(e.code, message)
  }
  return e instanceof Error ? e : new Error(String(e))
}

async function withClient<T>(
  cfg: FtpConfig,
  fn: (client: Client) => Promise<T>,
  control?: FtpControl
): Promise<T> {
  const key = poolKey(cfg)
  let entry = pools.get(key)
  if (!entry) {
    entry = { client: null, connected: false, chain: Promise.resolve(), idle: null }
    pools.set(key, entry)
  }
  const current = entry
  const run = current.chain.then(async () => {
    if (isCancelled(control)) throw new Error('cancelled')
    const client = current.client && !current.client.closed ? current.client : makeClient()
    current.client = client
    if (client.closed) current.connected = false
    try {
      if (!current.connected) {
        // `Client.access` is also the reconnect path after a closed connection.
        await client.access(accessOptions(cfg))
        current.connected = true
      }
    } catch (e) {
      client.close()
      current.client = null
      current.connected = false
      throw mapError(e)
    }
    try {
      const result = await fn(client)
      if (current.idle) clearTimeout(current.idle)
      current.idle = setTimeout(() => {
        if (current.client) current.client.close()
        current.client = null
        current.connected = false
        pools.delete(key)
      }, 60_000)
      current.idle.unref?.()
      return result
    } catch (e) {
      // a cancelled transfer leaves the data connection in an unknown state: drop the connection
      if (isCancelled(control) || client.closed) {
        client.close()
        current.client = null
        current.connected = false
      }
      throw mapError(e)
    }
  })
  current.chain = run.catch(() => undefined)
  return run
}

/** Public: close all pooled connections (app quit). */
export function closeFtpClients(): void {
  for (const entry of pools.values()) {
    if (entry.idle) clearTimeout(entry.idle)
    entry.client?.close()
  }
  pools.clear()
}

export async function ftpTest(cfg: FtpConfig): Promise<{ ok: true; root: string; entries: number }> {
  return withClient(cfg, async (client) => {
    const root = await client.pwd()
    const list = await client.list(root)
    return { ok: true, root, entries: list.length }
  })
}

export async function ftpList(cfg: FtpConfig, remotePath: string): Promise<FtpEntry[]> {
  return withClient(cfg, async (client) => {
    const infos = await client.list(remotePath)
    return infos
      .filter((i) => i.name !== '.' && i.name !== '..')
      .map((i) => toEntry(i))
  })
}

function toEntry(i: FileInfo): FtpEntry {
  return {
    name: i.name,
    dir: i.type === FileType.Directory,
    size: i.type === FileType.Directory ? 0 : Number(i.size) || 0,
    mtime: i.modifiedAt ? i.modifiedAt.getTime() : 0,
    link: i.type === FileType.SymbolicLink
  }
}

/** One entry by absolute path, derived from its parent listing (works for files and folders). */
export async function ftpStat(cfg: FtpConfig, remotePath: string): Promise<FtpEntry | null> {
  const clean = remotePath.replace(/\/+$/, '') || '/'
  if (clean === '/') return { name: '/', dir: true, size: 0, mtime: 0, link: false }
  const parent = path.posix.dirname(clean)
  const name = path.posix.basename(clean)
  const list = await ftpList(cfg, parent)
  return list.find((e) => e.name === name) ?? null
}

export async function ftpExists(cfg: FtpConfig, remotePath: string): Promise<boolean> {
  return (await ftpStat(cfg, remotePath)) !== null
}

export async function ftpMkdir(cfg: FtpConfig, remotePath: string): Promise<void> {
  await withClient(cfg, async (client) => {
    const folder = remotePath.replace(/\/+$/, '') || '/'
    if (folder === '/') return
    // a server that lists the folder already has it; MKD would be a 550
    const parent = path.posix.dirname(folder)
    const name = path.posix.basename(folder)
    const siblings = await client.list(parent).catch(() => [] as FileInfo[])
    if (siblings.some((s) => s.name === name)) throw new FtpError(550, 'a folder with that name already exists')
    const cwd = await client.pwd().catch(() => '/')
    await client.ensureDir(folder)
    if (cwd && cwd !== folder) await client.cd(cwd).catch(() => undefined)
  })
}

export async function ftpRemove(cfg: FtpConfig, remotePath: string, recursive = true): Promise<void> {
  const entry = await ftpStat(cfg, remotePath)
  if (!entry) return
  await withClient(cfg, async (client) => {
    if (entry.dir) await client.removeDir(remotePath)
    else await client.remove(remotePath)
  })
}

export async function ftpRename(cfg: FtpConfig, from: string, to: string): Promise<void> {
  await withClient(cfg, async (client) => {
    await client.rename(from, to)
  })
}

export async function ftpDownload(
  cfg: FtpConfig,
  remotePath: string,
  localPath: string,
  control: FtpControl = {}
): Promise<{ size: number }> {
  const tmp = `${localPath}.part`
  await fs.mkdir(path.dirname(localPath), { recursive: true })
  const file = createWriteStream(tmp)
  const via = new PassThrough()
  const done = pipeline(via, file)
  let total = 0
  let pausedNow = false
  via.on('data', (chunk: Buffer) => {
    total += chunk.length
    control.onBytes?.(chunk.length)
  })
  try {
    await withClient(
      cfg,
      async (client) => {
        client.trackProgress((info) => {
          if (info.type !== 'download') return
          if (isCancelled(control)) {
            via.destroy(new Error('cancelled'))
            return
          }
          if (control.paused?.() && !pausedNow) {
            pausedNow = true
            via.pause()
            void (control.waitIfPaused?.() ?? Promise.resolve()).then(() => {
              pausedNow = false
              if (!via.destroyed && !isCancelled(control)) via.resume()
            })
          }
        })
        try {
          await client.downloadTo(via, remotePath)
        } finally {
          client.trackProgress()
        }
      },
      control
    )
    await done
    await fs.rename(tmp, localPath)
    return { size: total }
  } catch (e) {
    via.destroy()
    file.destroy()
    await done.catch(() => undefined)
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    if (isCancelled(control)) throw new Error('cancelled')
    throw mapError(e)
  }
}

export async function ftpUpload(
  cfg: FtpConfig,
  localPath: string,
  remotePath: string,
  control: FtpControl = {}
): Promise<{ size: number }> {
  const st = await fs.stat(localPath)
  if (!st.isFile()) throw new FtpError(0, 'only regular files can be uploaded')
  // basic-ftp needs the parent to exist
  await withClient(cfg, async (client) => {
    const parent = path.posix.dirname(remotePath)
    const cwd = await client.pwd().catch(() => '/')
    await client.ensureDir(parent)
    if (cwd && cwd !== parent) await client.cd(cwd).catch(() => undefined)
  })
  const source = Readable.from(
    (async function* () {
      for await (const chunk of createReadStream(localPath, { highWaterMark: 1 << 20 })) {
        if (isCancelled(control)) throw new Error('cancelled')
        if (control.paused?.()) await control.waitIfPaused?.()
        if (isCancelled(control)) throw new Error('cancelled')
        control.onBytes?.((chunk as Buffer).length)
        yield chunk
      }
    })()
  )
  await withClient(
    cfg,
    async (client) => {
      await client.uploadFrom(source, remotePath)
    },
    control
  )
  return { size: st.size }
}
