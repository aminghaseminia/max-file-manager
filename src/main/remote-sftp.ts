import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createReadStream, createWriteStream } from 'node:fs'
import { Transform } from 'node:stream'
import type { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
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
}

type PoolEntry = {
  session: Session | null
  connected: boolean
  chain: Promise<unknown>
  idle: ReturnType<typeof setTimeout> | null
}

const pools = new Map<string, PoolEntry>()

function poolKey(cfg: SftpConfig): string {
  const secret = createHash('sha256')
    .update(`${cfg.password ?? ''}\u0000${cfg.passphrase ?? ''}\u0000${cfg.keyPath ?? ''}`)
    .digest('hex')
  return [cfg.host, cfg.port, cfg.user, cfg.auth, secret, cfg.acceptNewHostKey ? '1' : '0', cfg.hostKey ?? ''].join('\u0000')
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
  return { client, sftp, fingerprint }
}

async function withSftp<T>(
  cfg: SftpConfig,
  fn: (session: Session) => Promise<T>,
  control?: SftpControl
): Promise<T> {
  const key = poolKey(cfg)
  let entry = pools.get(key)
  if (!entry) {
    entry = { session: null, connected: false, chain: Promise.resolve(), idle: null }
    pools.set(key, entry)
  }
  const current = entry
  const run = current.chain.then(async () => {
    if (isCancelled(control)) throw new Error('cancelled')
    if (!current.connected || !current.session) {
      try {
        const session = await connect(cfg)
        current.session = session
        current.connected = true
        session.client.on('error', () => {
          current.session = null
          current.connected = false
        })
        session.client.on('close', () => {
          current.session = null
          current.connected = false
        })
      } catch (e) {
        current.session = null
        current.connected = false
        throw e
      }
    }
    try {
      const result = await fn(current.session!)
      if (current.idle) clearTimeout(current.idle)
      current.idle = setTimeout(() => {
        try {
          current.session?.client.end()
        } catch {
          // already closed
        }
        current.session = null
        current.connected = false
        pools.delete(key)
      }, 60_000)
      current.idle.unref?.()
      return result
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
    }
  })
  current.chain = run.catch(() => undefined)
  return run
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

async function ensureDirOn(sftp: SFTPWrapper, dir: string): Promise<void> {
  const clean = dir.replace(/\/+$/, '') || '/'
  if (clean === '/') return
  const absolute = clean.startsWith('/')
  const parts = clean.split('/').filter(Boolean)
  let cur = absolute ? '' : '.'
  for (const part of parts) {
    cur = cur === '' || cur === '.' ? (absolute ? `/${part}` : part) : `${cur}/${part}`
    const st = await statOf(sftp, cur).catch(() => null)
    if (st) {
      if (!st.isDirectory()) throw new SftpError('not_a_dir', `${cur} is not a folder`)
      continue
    }
    await mkdirOf(sftp, cur)
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

/** Async transform: progress + pause + cancel inside a pipeline (with real backpressure). */
function monitor(control: SftpControl): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, cb): void {
      void (async () => {
        try {
          if (isCancelled(control)) throw new Error('cancelled')
          if (control.paused?.()) await control.waitIfPaused?.()
          if (isCancelled(control)) throw new Error('cancelled')
          control.onBytes?.(chunk.length)
          cb(null, chunk)
        } catch (e) {
          cb(e as Error)
        }
      })()
    }
  })
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
        let total = 0
        const counting = new Transform({
          transform(chunk: Buffer, _enc, cb): void {
            total += chunk.length
            cb(null, chunk)
          }
        })
        const source = sftp.createReadStream(remotePath)
        const sink = createWriteStream(tmp)
        await pipeline(source as Readable, counting, monitor(control), sink as Writable)
        return total
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
    async ({ sftp }) => {
      await ensureDirOn(sftp, path.posix.dirname(remotePath))
      const source = createReadStream(localPath)
      const sink = sftp.createWriteStream(remotePath)
      await pipeline(source as Readable, monitor(control), sink as Writable)
    },
    control
  )
  return { size: st.size }
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
