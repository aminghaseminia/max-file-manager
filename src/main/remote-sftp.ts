import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createWriteStream } from 'node:fs'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { expandSshPath, fingerprintSha256 } from './ssh-config.ts'
import { knownHostEntriesFor, knownHostVerdict } from './ssh-known-hosts.ts'

/**
 * SFTP through the pure-JavaScript `ssh2` library, so nothing has to be installed: the app ships
 * its own SSH client. Authentication is password, a private key file, or an already-running SSH
 * agent; host keys are checked against `~/.ssh/known_hosts` (plain and hashed entries) and,
 * optionally, pinned on first use in the profile.
 *
 * Like the FTP pool, one connection per (host, user, key/password) is reused, operations are
 * serialised, and a broken connection is replaced on the next call.
 */
export type SftpAuth = 'password' | 'key' | 'agent'

export type SftpConfig = {
  host: string
  port: number
  user: string
  auth: SftpAuth
  password?: string
  keyPath?: string
  passphrase?: string
  agent?: string
  /** OpenSSH-style `SHA256:…` fingerprint already trusted for this host */
  hostKey?: string
  /** trust and remember an unknown host key (TOFU) */
  acceptNewHostKey?: boolean
  /** called once when TOFU accepted a new key, so the profile can remember it */
  onHostKey?: (fingerprint: string) => void
  home?: string
  /** offer SSH transport compression (zlib@openssh.com / zlib) for this session */
  compress?: boolean
}

export type SftpControl = {
  onBytes?: (n: number) => void
  cancelled?: () => boolean
  paused?: () => boolean
  waitIfPaused?: () => Promise<void>
}

export type SftpEntry = {
  name: string
  dir: boolean
  size: number
  mtime: number
  link: boolean
}

export class SftpError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message || code)
    this.name = 'SftpError'
    this.code = code
  }
}

const SFTP_NO_SUCH_FILE = 2
const SFTP_PERMISSION_DENIED = 3

const isCancelled = (control?: SftpControl): boolean => control?.cancelled?.() === true

function mapError(e: unknown): Error {
  if (e instanceof SftpError) return e
  const err = e as { code?: number | string; level?: string; message?: string }
  if (err?.level === 'client-authentication') {
    return new SftpError('auth', 'SSH rejected the credentials (password, key or agent)')
  }
  if (err?.code === SFTP_NO_SUCH_FILE) return new SftpError('not_found', 'the file or folder does not exist')
  if (err?.code === SFTP_PERMISSION_DENIED) return new SftpError('denied', 'permission denied by the SSH server')
  return new SftpError('sftp', err?.message || String(e))
}

type Session = {
  client: Client
  sftp: SFTPWrapper
  fingerprint: string
  /** folders already known to exist (or created) on this connection */
  dirs: Set<string>
  /** in-flight `mkdir` chains, so concurrent uploads to one new folder wait instead of racing */
  dirLocks: Map<string, Promise<void>>
}

type PoolEntry = {
  session: Session | null
  connected: boolean
  connecting: Promise<Session> | null
  /** operations currently using this connection */
  active: number
  idle: ReturnType<typeof setTimeout> | null
}

const pools = new Map<string, PoolEntry>()

function poolKey(cfg: SftpConfig): string {
  const secret = createHash('sha256')
    .update(`${cfg.password ?? ''}\u0000${cfg.passphrase ?? ''}\u0000${cfg.keyPath ?? ''}`)
    .digest('hex')
  return [
    cfg.host,
    cfg.port,
    cfg.user,
    cfg.auth,
    secret,
    cfg.acceptNewHostKey ? '1' : '0',
    cfg.hostKey ?? '',
    cfg.compress ? 'z1' : 'z0'
  ].join('\u0000')
}

async function readKnownHosts(home: string): Promise<string> {
  const files = [path.join(home, '.ssh', 'known_hosts'), '/etc/ssh/ssh_known_hosts']
  const parts: string[] = []
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8').catch(() => '')
    if (text) parts.push(text)
  }
  return parts.join('\n')
}

async function privateKeyOf(cfg: SftpConfig): Promise<Buffer> {
  const raw = String(cfg.keyPath ?? '').trim()
  if (!raw) throw new SftpError('key', 'no private key file was configured')
  const file = expandSshPath(raw, {
    home: cfg.home ?? os.homedir(),
    host: cfg.host,
    user: cfg.user
  })
  const st = await fs.stat(file).catch(() => null)
  if (!st?.isFile()) throw new SftpError('key', `the private key file was not found: ${file}`)
  return fs.readFile(file)
}

/** One SSH connection + SFTP subsystem. */
async function connect(cfg: SftpConfig): Promise<Session> {
  const home = cfg.home ?? os.homedir()
  const known = await readKnownHosts(home)
  const client = new Client()
  let fingerprint = ''
  let verifierMessage = ''
  let learned = false

  const hostVerifier = (key: Buffer): boolean => {
    fingerprint = fingerprintSha256(key)
    const verdict = knownHostVerdict(known, cfg.host, cfg.port, key.toString('base64'))
    if (verdict === 'trusted') return true
    if (verdict === 'revoked') {
      verifierMessage = `the host key for ${cfg.host} is marked @revoked in known_hosts`
      return false
    }
    if (cfg.hostKey) {
      if (cfg.hostKey.trim() === fingerprint) return true
      verifierMessage =
        `the host key for ${cfg.host}:${cfg.port} does not match the key pinned for this connection (${fingerprint}). ` +
        'If the server key really changed, forget the saved key first.'
      return false
    }
    const knownHost = knownHostEntriesFor(known, cfg.host, cfg.port).length > 0
    if (knownHost) {
      verifierMessage =
        `the host key for ${cfg.host}:${cfg.port} does not match known_hosts (${fingerprint}). ` +
        'Remove the old entry with `ssh-keygen -R` if the server was reinstalled.'
      return false
    }
    if (cfg.acceptNewHostKey) {
      learned = true
      return true
    }
    verifierMessage =
      `unknown host key ${fingerprint} for ${cfg.host}:${cfg.port}. ` +
      'Add it to ~/.ssh/known_hosts, or enable trust-on-first-use for this connection.'
    return false
  }

  const opts: ConnectConfig = {
    host: cfg.host,
    port: cfg.port,
    username: cfg.user,
    readyTimeout: 30_000,
    keepaliveInterval: 30_000,
    keepaliveCountMax: 3,
    tryKeyboard: false,
    hostVerifier
  }
  if (cfg.compress) opts.algorithms = { compress: ['zlib@openssh.com', 'zlib', 'none'] }
  if (cfg.auth === 'agent') {
    const agent = cfg.agent ?? process.env.SSH_AUTH_SOCK ?? (process.platform === 'win32' ? 'pageant' : '')
    if (!agent) throw new SftpError('agent', 'no SSH agent was found (SSH_AUTH_SOCK is empty)')
    opts.agent = agent
    opts.authHandler = ['agent']
  } else if (cfg.auth === 'key') {
    opts.privateKey = await privateKeyOf(cfg)
    if (cfg.passphrase) opts.passphrase = cfg.passphrase
    opts.authHandler = ['publickey']
  } else {
    opts.password = cfg.password ?? ''
    opts.authHandler = ['password']
  }

  await new Promise<void>((resolve, reject) => {
    const onReady = (): void => {
      client.removeListener('error', onError)
      resolve()
    }
    const onError = (e: Error): void => {
      client.removeListener('ready', onReady)
      if (verifierMessage) reject(new SftpError('hostkey', verifierMessage))
      else reject(mapError(e))
    }
    client.once('ready', onReady)
    client.once('error', onError)
    try {
      client.connect(opts)
      // Nagle would make every small SFTP request wait for the 40 ms delayed ACK: a 64 KB
      // read then runs at ~1.5 MB/s even on a LAN. ssh2 never sets it by itself.
      client.setNoDelay(true)
    } catch (e) {
      client.removeListener('ready', onReady)
      client.removeListener('error', onError)
      reject(mapError(e))
    }
  })

  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((err, wrapper) => (err ? reject(mapError(err)) : resolve(wrapper)))
  })
  client.on('error', () => {
    // keep an error listener alive: ssh2 emits errors on the Client, and an unhandled one
    // would take the whole main process down. The next operation reconnects.
    try {
      client.end()
    } catch {
      // already gone
    }
  })
  if (learned && fingerprint && cfg.onHostKey) cfg.onHostKey(fingerprint)
  return { client, sftp, fingerprint, dirs: new Set<string>(['/']), dirLocks: new Map() }
}

/** The shared connection, opened once even when several transfers start together. */
async function sessionOf(key: string, cfg: SftpConfig, entry: PoolEntry): Promise<Session> {
  if (entry.connected && entry.session) return entry.session
  if (entry.connecting) return entry.connecting
  const pending = connect(cfg).then((session) => {
    // closeSftpClients() may have run while the handshake was in flight
    if (pools.get(key) !== entry) {
      try {
        session.client.end()
      } catch {
        // already closed
      }
      throw new SftpError('sftp', 'the connection was closed')
    }
    entry.session = session
    entry.connected = true
    const drop = (): void => {
      if (entry.session === session) {
        entry.session = null
        entry.connected = false
      }
    }
    session.client.on('error', drop)
    session.client.on('close', drop)
    return session
  })
  entry.connecting = pending
  try {
    return await pending
  } finally {
    if (entry.connecting === pending) entry.connecting = null
  }
}

function scheduleIdle(key: string, entry: PoolEntry): void {
  if (entry.idle) clearTimeout(entry.idle)
  entry.idle = setTimeout(() => {
    if (entry.active > 0) return
    try {
      entry.session?.client.end()
    } catch {
      // already closed
    }
    entry.session = null
    entry.connected = false
    if (pools.get(key) === entry) pools.delete(key)
  }, 60_000)
  entry.idle.unref?.()
}

async function withSftp<T>(
  cfg: SftpConfig,
  fn: (session: Session) => Promise<T>,
  control?: SftpControl
): Promise<T> {
  if (isCancelled(control)) throw new Error('cancelled')
  const key = poolKey(cfg)
  let entry = pools.get(key)
  if (!entry) {
    entry = { session: null, connected: false, connecting: null, active: 0, idle: null }
    pools.set(key, entry)
  }
  const current = entry
  if (current.idle) {
    clearTimeout(current.idle)
    current.idle = null
  }
  // ssh2 multiplexes SFTP requests on one session, so several files can move at once instead of
  // paying a full round trip per file. Connect/teardown is still coordinated here.
  current.active++
  try {
    const session = await sessionOf(key, cfg, current)
    if (isCancelled(control)) throw new Error('cancelled')
    return await fn(session)
  } catch (e) {
    if (isCancelled(control)) {
      try {
        current.session?.client.end()
      } catch {
        // already closed
      }
      current.session = null
      current.connected = false
    }
    throw mapError(e)
  } finally {
    current.active--
    if (current.active === 0) scheduleIdle(key, current)
  }
}

export function closeSftpClients(): void {
  for (const entry of pools.values()) {
    if (entry.idle) clearTimeout(entry.idle)
    try {
      entry.session?.client.end()
    } catch {
      // already closed
    }
  }
  pools.clear()
}

const readdir = (sftp: SFTPWrapper, p: string): Promise<import('ssh2').FileEntryWithStats[]> =>
  new Promise((resolve, reject) => sftp.readdir(p, (err, list) => (err ? reject(err) : resolve(list))))

const statOf = (sftp: SFTPWrapper, p: string): Promise<import('ssh2').Stats> =>
  new Promise((resolve, reject) => sftp.stat(p, (err, stats) => (err ? reject(err) : resolve(stats))))

const lstatOf = (sftp: SFTPWrapper, p: string): Promise<import('ssh2').Stats> =>
  new Promise((resolve, reject) => sftp.lstat(p, (err, stats) => (err ? reject(err) : resolve(stats))))

const mkdirOf = (sftp: SFTPWrapper, p: string): Promise<void> =>
  new Promise((resolve, reject) => sftp.mkdir(p, (err) => (err ? reject(err) : resolve())))

const unlinkOf = (sftp: SFTPWrapper, p: string): Promise<void> =>
  new Promise((resolve, reject) => sftp.unlink(p, (err) => (err ? reject(err) : resolve())))

const rmdirOf = (sftp: SFTPWrapper, p: string): Promise<void> =>
  new Promise((resolve, reject) => sftp.rmdir(p, (err) => (err ? reject(err) : resolve())))

const renameOf = (sftp: SFTPWrapper, from: string, to: string): Promise<void> =>
  new Promise((resolve, reject) => sftp.rename(from, to, (err) => (err ? reject(err) : resolve())))

function toEntry(item: import('ssh2').FileEntryWithStats): SftpEntry {
  return {
    name: item.filename,
    dir: item.attrs.isDirectory(),
    size: item.attrs.isDirectory() ? 0 : Number(item.attrs.size) || 0,
    mtime: Number(item.attrs.mtime) ? Number(item.attrs.mtime) * 1000 : 0,
    link: item.attrs.isSymbolicLink()
  }
}

export async function sftpList(cfg: SftpConfig, remotePath: string): Promise<SftpEntry[]> {
  return withSftp(cfg, async ({ sftp }) => {
    const list = await readdir(sftp, remotePath || '/')
    return list.filter((i) => i.filename !== '.' && i.filename !== '..').map(toEntry)
  })
}

export async function sftpStat(cfg: SftpConfig, remotePath: string): Promise<SftpEntry | null> {
  const clean = remotePath.replace(/\/+$/, '') || '/'
  if (clean === '/') return { name: '/', dir: true, size: 0, mtime: 0, link: false }
  return withSftp(cfg, async ({ sftp }) => {
    try {
      const l = await lstatOf(sftp, clean)
      if (l.isSymbolicLink()) {
        const target = await statOf(sftp, clean).catch(() => null)
        if (target) {
          return {
            name: path.posix.basename(clean),
            dir: target.isDirectory(),
            size: target.isDirectory() ? 0 : Number(target.size) || 0,
            mtime: Number(target.mtime) * 1000 || 0,
            link: true
          }
        }
      }
      return {
        name: path.posix.basename(clean),
        dir: l.isDirectory(),
        size: l.isDirectory() ? 0 : Number(l.size) || 0,
        mtime: Number(l.mtime) * 1000 || 0,
        link: l.isSymbolicLink()
      }
    } catch (e) {
      const mapped = mapError(e)
      if (mapped instanceof SftpError && mapped.code === 'not_found') return null
      throw mapped
    }
  })
}

export async function sftpExists(cfg: SftpConfig, remotePath: string): Promise<boolean> {
  return (await sftpStat(cfg, remotePath)) !== null
}

async function ensureDirOn(session: Session, dir: string): Promise<void> {
  const clean = dir.replace(/\/+$/, '') || '/'
  if (clean === '/' || session.dirs.has(clean)) return
  // another upload to the same new folder may already be creating it
  const running = session.dirLocks.get(clean)
  if (running) return running
  const task = (async () => {
    const absolute = clean.startsWith('/')
    const parts = clean.split('/').filter(Boolean)
    let cur = absolute ? '' : '.'
    for (const part of parts) {
      cur = cur === '' || cur === '.' ? (absolute ? `/${part}` : part) : `${cur}/${part}`
      if (session.dirs.has(cur)) continue
      const st = await statOf(session.sftp, cur).catch(() => null)
      if (st) {
        if (!st.isDirectory()) throw new SftpError('not_a_dir', `${cur} is not a folder`)
        session.dirs.add(cur)
        continue
      }
      try {
        await mkdirOf(session.sftp, cur)
      } catch (e) {
        // a concurrent upload may have created it between our stat and mkdir
        const again = await statOf(session.sftp, cur).catch(() => null)
        if (!again?.isDirectory()) throw e
      }
      session.dirs.add(cur)
    }
  })()
  session.dirLocks.set(clean, task)
  try {
    await task
  } finally {
    if (session.dirLocks.get(clean) === task) session.dirLocks.delete(clean)
  }
}

export async function sftpMkdir(cfg: SftpConfig, remotePath: string): Promise<void> {
  await withSftp(cfg, async ({ sftp }) => {
    const clean = remotePath.replace(/\/+$/, '') || '/'
    if (clean === '/') throw new SftpError('exists', 'the root folder already exists')
    if (await statOf(sftp, clean).catch(() => null)) throw new SftpError('exists', 'a folder with that name already exists')
    await mkdirOf(sftp, clean)
  })
}

async function removeOn(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  const st = await lstatOf(sftp, remotePath).catch(() => null)
  if (!st) return
  if (st.isDirectory() && !st.isSymbolicLink()) {
    const kids = await readdir(sftp, remotePath)
    for (const kid of kids) {
      if (kid.filename === '.' || kid.filename === '..') continue
      await removeOn(sftp, path.posix.join(remotePath, kid.filename))
    }
    await rmdirOf(sftp, remotePath)
    return
  }
  await unlinkOf(sftp, remotePath)
}

export async function sftpRemove(cfg: SftpConfig, remotePath: string): Promise<void> {
  await withSftp(cfg, async ({ sftp }) => removeOn(sftp, remotePath))
}

export async function sftpRename(cfg: SftpConfig, from: string, to: string): Promise<void> {
  await withSftp(cfg, async ({ sftp }) => {
    if (await statOf(sftp, to).catch(() => null)) throw new SftpError('exists', 'the destination already exists')
    await renameOf(sftp, from, to)
  })
}

const openOf = (sftp: SFTPWrapper, p: string, flags: 'r' | 'w'): Promise<Buffer> =>
  new Promise((resolve, reject) => sftp.open(p, flags, (err, handle) => (err ? reject(err) : resolve(handle))))

const fstatOf = (sftp: SFTPWrapper, handle: Buffer): Promise<import('ssh2').Stats> =>
  new Promise((resolve, reject) => sftp.fstat(handle, (err, stats) => (err ? reject(err) : resolve(stats))))

const closeOf = (sftp: SFTPWrapper, handle: Buffer): Promise<void> =>
  new Promise((resolve, reject) => sftp.close(handle, (err) => (err ? reject(err) : resolve())))

const readAt = async (sftp: SFTPWrapper, handle: Buffer, offset: number, len: number): Promise<Buffer> => {
  const buf = Buffer.allocUnsafe(len)
  let got = 0
  while (got < len) {
    const n = await new Promise<number>((resolve, reject) => {
      sftp.read(handle, buf, got, len - got, offset + got, (err: Error | undefined, bytes: number) =>
        err ? reject(err) : resolve(bytes)
      )
    })
    if (!n) throw new Error('unexpected end of file')
    got += n
  }
  return buf
}

const writeAt = (sftp: SFTPWrapper, handle: Buffer, buf: Buffer, offset: number): Promise<void> =>
  new Promise((resolve, reject) => {
    sftp.write(handle, buf, 0, buf.length, offset, (err: Error | null | undefined, written?: number) => {
      if (err) return reject(err)
      // ssh2 splits writes larger than the negotiated limit and reports the final piece only;
      // IO_CHUNK stays below the smallest allowed limit (32 KB), so one write is one request
      if (written !== undefined && written !== buf.length) reject(new Error('short SFTP write'))
      else resolve()
    })
  })

/**
 * 64 requests of 32 KB in flight, like OpenSSH's sftp client: one request per round trip would cap
 * a 50 ms link at ~0.6 MB/s even though the link itself is much faster.
 */
const IO_CHUNK = 32 * 1024
const IO_WINDOW = 64

async function waitIfPaused(control: SftpControl): Promise<void> {
  while (control.paused?.() && !isCancelled(control)) {
    if (control.waitIfPaused) await control.waitIfPaused()
    else await new Promise((r) => setTimeout(r, 100))
  }
  if (isCancelled(control)) throw new Error('cancelled')
}

async function readRemote(
  sftp: SFTPWrapper,
  handle: Buffer,
  size: number,
  tmp: string,
  control: SftpControl
): Promise<number> {
  const sink = createWriteStream(tmp)
  try {
    let done = 0
    while (done < size) {
      await waitIfPaused(control)
      const batch: Array<{ off: number; len: number }> = []
      for (let i = 0; i < IO_WINDOW && done + i * IO_CHUNK < size; i++) {
        const off = done + i * IO_CHUNK
        batch.push({ off, len: Math.min(IO_CHUNK, size - off) })
      }
      const bufs = await Promise.all(batch.map(({ off, len }) => readAt(sftp, handle, off, len)))
      for (const buf of bufs) {
        if (!sink.write(buf)) await new Promise<void>((resolve) => sink.once('drain', resolve))
        control.onBytes?.(buf.length)
      }
      done += batch.reduce((n, b) => n + b.len, 0)
    }
    await new Promise<void>((resolve, reject) => {
      sink.end(() => resolve())
      sink.on('error', reject)
    })
    return done
  } catch (e) {
    sink.destroy()
    throw e
  }
}

async function writeRemote(
  sftp: SFTPWrapper,
  handle: Buffer,
  localPath: string,
  size: number,
  control: SftpControl
): Promise<void> {
  // never let one request exceed the server's negotiated write limit: ssh2 would split it and
  // report only the last piece, which makes byte accounting and short-write checks lie
  const maxWrite = (sftp as unknown as { _maxWriteLen?: number })._maxWriteLen ?? IO_CHUNK
  const chunk = Math.max(4096, Math.min(IO_CHUNK, maxWrite))
  const fd = await fs.open(localPath, 'r')
  try {
    let pos = 0
    while (pos < size) {
      await waitIfPaused(control)
      const batch: Array<{ off: number; buf: Buffer }> = []
      for (let i = 0; i < IO_WINDOW && pos + i * chunk < size; i++) {
        const off = pos + i * chunk
        const len = Math.min(chunk, size - off)
        const buf = Buffer.allocUnsafe(len)
        let read = 0
        while (read < len) {
          const { bytesRead } = await fd.read(buf, read, len - read, off + read)
          if (!bytesRead) throw new Error('unexpected end of local file')
          read += bytesRead
        }
        batch.push({ off, buf })
      }
      await Promise.all(batch.map(({ off, buf }) => writeAt(sftp, handle, buf, off)))
      const n = batch.reduce((sum, b) => sum + b.buf.length, 0)
      pos += n
      control.onBytes?.(n)
    }
  } finally {
    await fd.close().catch(() => undefined)
  }
}

export async function sftpDownload(
  cfg: SftpConfig,
  remotePath: string,
  localPath: string,
  control: SftpControl = {}
): Promise<{ size: number }> {
  const tmp = `${localPath}.part`
  await fs.mkdir(path.dirname(localPath), { recursive: true })
  try {
    const size = await withSftp(
      cfg,
      async ({ sftp }) => {
        const handle = await openOf(sftp, remotePath, 'r')
        try {
          const st = await fstatOf(sftp, handle)
          return await readRemote(sftp, handle, Number(st.size) || 0, tmp, control)
        } finally {
          await closeOf(sftp, handle).catch(() => undefined)
        }
      },
      control
    )
    await fs.rename(tmp, localPath)
    return { size }
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    if (isCancelled(control)) throw new Error('cancelled')
    throw mapError(e)
  }
}

export async function sftpUpload(
  cfg: SftpConfig,
  localPath: string,
  remotePath: string,
  control: SftpControl = {}
): Promise<{ size: number }> {
  const st = await fs.stat(localPath)
  if (!st.isFile()) throw new SftpError('not_a_file', 'only regular files can be uploaded')
  await withSftp(
    cfg,
    async (session) => {
      const { sftp } = session
      await ensureDirOn(session, path.posix.dirname(remotePath))
      const handle = await openOf(sftp, remotePath, 'w')
      try {
        await writeRemote(sftp, handle, localPath, st.size, control)
      } finally {
        await closeOf(sftp, handle).catch(() => undefined)
      }
    },
    control
  )
  return { size: st.size }
}

/** Set the modification time after an upload; SFTP servers keep it, so the next sync is stable. */
export async function sftpUtimes(cfg: SftpConfig, remotePath: string, mtimeMs: number): Promise<void> {
  const secs = Math.floor(mtimeMs / 1000)
  await withSftp(cfg, async ({ sftp }) => {
    await new Promise<void>((resolve, reject) => {
      sftp.utimes(remotePath, secs, secs, (err) => (err ? reject(mapError(err)) : resolve()))
    })
  })
}

export async function sftpTest(
  cfg: SftpConfig
): Promise<{ ok: true; hostKey: string; root: string; entries: number }> {
  return withSftp(cfg, async ({ sftp, fingerprint }) => {
    // a chrooted account may not be allowed to list `/`; the login home always exists
    const root = await new Promise<string>((resolve) => {
      sftp.realpath('.', (err, p) => resolve(err || !p ? '/' : p))
    })
    const list = await readdir(sftp, root)
    return { ok: true as const, hostKey: fingerprint, root, entries: list.length }
  })
}
