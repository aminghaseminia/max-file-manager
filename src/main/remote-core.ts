import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  formatRemote,
  isRemotePath,
  parseRemote,
  remoteDir,
  remoteJoin,
  remoteName,
  remoteOriginKey,
  remoteParent,
  remotePathOf,
  remoteProtocolLabel,
  remoteRoot,
  type RemoteLocation
} from '../shared/remote-path.ts'
import type { DirRef, Entry, Listing } from './types.ts'
import {
  s3CopyObject,
  s3CopyPrefix,
  s3DeleteObject,
  s3Download,
  s3Head,
  s3IsPrefix,
  s3List,
  s3Mkdir,
  s3PutBuffer,
  s3Remove,
  s3Upload,
  S3Error,
  type S3Config,
  type S3Control
} from './s3.ts'
import {
  ftpDownload,
  ftpExists,
  ftpList,
  ftpMkdir,
  ftpRemove,
  ftpRename,
  ftpStat,
  ftpUpload,
  FtpError,
  type FtpConfig
} from './remote-ftp.ts'
import {
  sftpDownload,
  sftpList,
  sftpMkdir,
  sftpRemove,
  sftpRename,
  sftpStat,
  sftpUpload,
  SftpError,
  type SftpAuth,
  type SftpConfig
} from './remote-sftp.ts'

/**
 * The one abstraction every caller uses for a remote location: `fs:list`, the transfer engine and
 * the MCP tools all speak it. Protocol details (FTP vs S3) and credential lookup stay behind this
 * interface, so nothing else in main has to know how a remote path is served.
 */
export type RemoteControl = {
  onBytes?: (n: number) => void
  cancelled?: () => boolean
  paused?: () => boolean
  waitIfPaused?: () => Promise<void>
}

export type FtpRemoteConfig = {
  protocol: 'ftp' | 'ftps'
  host?: string
  port?: number
  user?: string
  password?: string
  implicitTLS?: boolean
  verifyTls?: boolean
}

export type S3RemoteConfig = {
  protocol: 's3'
  bucket?: string
  region?: string
  endpoint?: string
  pathStyle?: boolean
  accessKey: string
  secretKey: string
  sessionToken?: string
  verifyTls?: boolean
}

export type SftpRemoteConfig = {
  protocol: 'sftp'
  host?: string
  port?: number
  user?: string
  auth: SftpAuth
  password?: string
  keyPath?: string
  passphrase?: string
  agent?: string
  hostKey?: string
  acceptNewHostKey?: boolean
  onHostKey?: (fingerprint: string) => void
}

export type RemoteConfig = FtpRemoteConfig | SftpRemoteConfig | S3RemoteConfig
export type RemoteResolution = { id: string; name: string; config: RemoteConfig }
export type RemoteResolver = (location: RemoteLocation) => Promise<RemoteResolution>

export class RemoteError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 0) {
    super(message || code)
    this.name = 'RemoteError'
    this.code = code
    this.status = status
  }
}

function mapError(e: unknown): Error {
  if (e instanceof RemoteError) return e
  if (e instanceof S3Error) {
    const code = e.status === 403 ? 'auth' : e.status === 404 || e.code === 'NoSuchKey' ? 'not_found' : e.code
    return new RemoteError(code, e.region ? `${e.message} (bucket region: ${e.region})` : e.message, e.status)
  }
  if (e instanceof FtpError) {
    const code = e.code === 530 ? 'auth' : e.code === 550 ? 'not_found' : 'ftp'
    return new RemoteError(code, e.message, e.code)
  }
  if (e instanceof SftpError) {
    return new RemoteError(e.code, e.message)
  }
  if (e instanceof Error) {
    if (e.message === 'cancelled') return new RemoteError('cancelled', 'the transfer was cancelled')
    return new RemoteError((e as NodeJS.ErrnoException).code || 'remote', e.message)
  }
  return new RemoteError('remote', String(e))
}

const isMissing = (e: unknown): boolean =>
  e instanceof RemoteError
    ? e.code === 'not_found'
    : e instanceof S3Error
      ? e.status === 404
      : e instanceof FtpError
        ? e.code === 550
        : false

function assertSafe(loc: RemoteLocation): void {
  if (loc.hasPassword) {
    throw new RemoteError(
      'password_in_url',
      'passwords are not accepted in a remote path; open Remote connections and enter it there'
    )
  }
  if (/[\0\r\n]/.test(loc.path) || /[\0\r\n]/.test(loc.host)) {
    throw new RemoteError('bad_path', 'the remote path contains a control character')
  }
}

function s3Config(resolved: RemoteResolution, loc: RemoteLocation): S3Config {
  const c = resolved.config
  if (c.protocol !== 's3') throw new RemoteError('no_profile', 'this location needs an S3 connection profile')
  return {
    bucket: loc.host || c.bucket || '',
    region: c.region || 'us-east-1',
    endpoint: c.endpoint || undefined,
    pathStyle: c.pathStyle,
    accessKey: c.accessKey,
    secretKey: c.secretKey,
    sessionToken: c.sessionToken || undefined,
    verifyTls: c.verifyTls !== false
  }
}

function sftpConfigOf(resolved: RemoteResolution, loc: RemoteLocation): SftpConfig {
  const c = resolved.config
  if (c.protocol !== 'sftp') throw new RemoteError('no_profile', 'this location needs an SFTP connection profile')
  return {
    host: loc.host || c.host || '',
    port: loc.port || c.port || 22,
    user: loc.user || c.user || '',
    auth: c.auth || 'password',
    password: c.password,
    keyPath: c.keyPath,
    passphrase: c.passphrase,
    agent: c.agent,
    hostKey: c.hostKey,
    acceptNewHostKey: c.acceptNewHostKey,
    onHostKey: c.onHostKey
  }
}

function ftpConfig(resolved: RemoteResolution, loc: RemoteLocation): FtpConfig {
  const c = resolved.config
  if (c.protocol !== 'ftp' && c.protocol !== 'ftps') {
    throw new RemoteError('no_profile', 'this location needs an FTP connection profile')
  }
  return {
    host: loc.host || c.host || '',
    port: loc.port || c.port || (c.implicitTLS ? 990 : 21),
    user: loc.user || c.user || 'anonymous',
    password: c.password || '',
    secure: loc.scheme === 'ftps' ? (c.implicitTLS ? 'implicit' : 'explicit') : 'none',
    verifyTls: c.verifyTls !== false
  }
}

const extOf = (name: string): string => {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

const posix = path.posix

function s3PrefixOf(key: string): string {
  return key ? key.replace(/\/+$/, '') + '/' : ''
}

export type RemoteFs = ReturnType<typeof createRemoteFs>

export function createRemoteFs(
  resolve: RemoteResolver,
  opts: { tempDir?: string; listPages?: number; measureMs?: number } = {}
) {
  const tempRoot = opts.tempDir ?? os.tmpdir()

  async function resolved(uri: string): Promise<{ loc: RemoteLocation; resolution: RemoteResolution }> {
    const loc = parseRemote(uri)
    if (!loc) throw new RemoteError('bad_path', 'not a remote location')
    assertSafe(loc)
    const resolution = await resolve(loc)
    return { loc, resolution }
  }

  async function list(uri: string, showHidden = false): Promise<Listing> {
    const { loc, resolution } = await resolved(uri)
    let entries: Entry[] = []
    if (loc.scheme === 's3') {
      const cfg = s3Config(resolution, loc)
      const prefix = s3PrefixOf(loc.path)
      const found = await s3List(cfg, prefix, { maxPages: opts.listPages ?? 50 })
      const byName = new Map<string, Entry>()
      const add = (name: string, dir: boolean, size = 0, mtime = 0): void => {
        if (!name || name === '.' || name === '..') return
        const old = byName.get(name)
        if (old && old.dir) return
        if (old && !dir) return
        byName.set(name, {
          name,
          path: safeJoin(uri, name),
          dir,
          size,
          mtime,
          ext: dir ? '' : extOf(name)
        })
      }
      for (const p of found.prefixes) {
        const rel = p.startsWith(prefix) ? p.slice(prefix.length) : p
        const name = rel.replace(/\/+$/, '').split('/').pop() ?? ''
        if (name) add(name, true)
      }
      for (const o of found.objects) {
        if (o.key === prefix) continue
        const rel = o.key.startsWith(prefix) ? o.key.slice(prefix.length) : o.key
        if (!rel) continue
        const marker = rel.endsWith('/')
        const name = marker ? rel.slice(0, -1) : rel
        // a key deeper than one level (some S3 servers ignore the delimiter) is shown as its folder
        if (name.includes('/')) {
          const folder = name.split('/')[0]
          if (folder) add(folder, true)
          continue
        }
        add(name, marker, marker ? 0 : o.size, o.mtime)
      }
      entries = [...byName.values()]
    } else if (loc.scheme === 'sftp') {
      const cfg = sftpConfigOf(resolution, loc)
      const found = await sftpList(cfg, loc.path || '/')
      entries = found.map((e) => ({
        name: e.name,
        path: safeJoin(uri, e.name),
        dir: e.dir,
        size: e.dir ? 0 : e.size,
        mtime: e.mtime,
        ext: e.dir ? '' : extOf(e.name),
        link: e.link || undefined
      }))
    } else {
      const cfg = ftpConfig(resolution, loc)
      const found = await ftpList(cfg, loc.path || '/')
      entries = found.map((e) => ({
        name: e.name,
        path: safeJoin(uri, e.name),
        dir: e.dir,
        size: e.dir ? 0 : e.size,
        mtime: e.mtime,
        ext: e.dir ? '' : extOf(e.name),
        link: e.link || undefined
      }))
    }
    if (!showHidden) entries = entries.filter((e) => !e.name.startsWith('.'))
    entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
    return { path: uri, parent: remoteParent(uri), entries }
  }

  function safeJoin(uri: string, name: string): string {
    try {
      return remoteJoin(uri, name)
    } catch {
      return uri
    }
  }

  async function dirs(uri: string, showHidden = false): Promise<DirRef[]> {
    const listing = await list(uri, showHidden)
    return listing.entries
      .filter((e) => e.dir)
      .slice(0, 1000)
      .map((e) => ({ name: e.name, path: e.path, ...(e.link ? { link: true } : {}) }))
  }

  async function stat(uri: string): Promise<{ name: string; dir: boolean; size: number; mtime: number; link?: boolean } | null> {
    const { loc, resolution } = await resolved(uri)
    try {
      if (loc.scheme === 's3') {
        const cfg = s3Config(resolution, loc)
        if (!loc.path) return { name: loc.host, dir: true, size: 0, mtime: 0 }
        const head = await s3Head(cfg, loc.path)
        if (head) {
          if (head.key.endsWith('/')) return { name: remoteName(uri), dir: true, size: 0, mtime: head.mtime }
          return { name: remoteName(uri), dir: false, size: head.size, mtime: head.mtime }
        }
        if (await s3IsPrefix(cfg, loc.path)) return { name: remoteName(uri), dir: true, size: 0, mtime: 0 }
        return null
      }
      if (loc.scheme === 'sftp') {
        const e = await sftpStat(sftpConfigOf(resolution, loc), loc.path || '/')
        return e ? { name: e.name, dir: e.dir, size: e.size, mtime: e.mtime, link: e.link || undefined } : null
      }
      const e = await ftpStat(ftpConfig(resolution, loc), loc.path || '/')
      return e ? { name: e.name, dir: e.dir, size: e.size, mtime: e.mtime, link: e.link || undefined } : null
    } catch (e) {
      if (isMissing(e)) return null
      throw mapError(e)
    }
  }

  async function exists(uri: string): Promise<boolean> {
    return (await stat(uri)) !== null
  }

  async function measure(uri: string): Promise<{ bytes: number; files: number; capped: boolean }> {
    const st = await stat(uri)
    if (!st) return { bytes: 0, files: 0, capped: false }
    if (!st.dir) return { bytes: st.size, files: 1, capped: false }
    const deadline = Date.now() + (opts.measureMs ?? 15_000)
    let bytes = 0
    let files = 0
    let capped = false
    const stack = [uri]
    while (stack.length) {
      if (files > 100_000 || Date.now() > deadline) {
        capped = true
        break
      }
      const dir = stack.pop()!
      const found = await list(dir, true).catch(() => null)
      if (!found) {
        capped = true
        continue
      }
      for (const e of found.entries) {
        if (e.dir) stack.push(e.path)
        else {
          bytes += e.size
          files++
        }
      }
    }
    return { bytes, files, capped }
  }

  async function downloadFile(uri: string, localPath: string, control: RemoteControl = {}): Promise<{ size: number }> {
    const { loc, resolution } = await resolved(uri)
    try {
      await fs.mkdir(path.dirname(localPath), { recursive: true })
      if (loc.scheme === 's3') {
        return await s3Download(s3Config(resolution, loc), loc.path, localPath, control as S3Control)
      }
      if (loc.scheme === 'sftp') {
        return await sftpDownload(sftpConfigOf(resolution, loc), loc.path, localPath, control)
      }
      return await ftpDownload(ftpConfig(resolution, loc), loc.path, localPath, control)
    } catch (e) {
      throw mapError(e)
    }
  }

  async function uploadFile(localPath: string, uri: string, control: RemoteControl = {}): Promise<{ size: number }> {
    const { loc, resolution } = await resolved(uri)
    try {
      if (loc.scheme === 's3') {
        return await s3Upload(s3Config(resolution, loc), loc.path, localPath, control as S3Control)
      }
      if (loc.scheme === 'sftp') {
        return await sftpUpload(sftpConfigOf(resolution, loc), localPath, loc.path, control)
      }
      return await ftpUpload(ftpConfig(resolution, loc), localPath, loc.path, control)
    } catch (e) {
      throw mapError(e)
    }
  }

  async function mkdir(uri: string): Promise<void> {
    const { loc, resolution } = await resolved(uri)
    try {
      if (loc.scheme === 's3') {
        if (!loc.path) throw new RemoteError('exists', 'the bucket root already exists')
        await s3Mkdir(s3Config(resolution, loc), loc.path)
        return
      }
      if (loc.scheme === 'sftp') {
        await sftpMkdir(sftpConfigOf(resolution, loc), loc.path || '/')
        return
      }
      await ftpMkdir(ftpConfig(resolution, loc), loc.path || '/')
    } catch (e) {
      throw mapError(e)
    }
  }

  async function remove(uri: string): Promise<void> {
    const { loc, resolution } = await resolved(uri)
    try {
      if (loc.scheme === 's3') {
        if (!loc.path) throw new RemoteError('unsupported', 'the bucket root cannot be deleted')
        await s3Remove(s3Config(resolution, loc), loc.path, true)
        return
      }
      if (loc.scheme === 'sftp') {
        if (!loc.path) throw new RemoteError('unsupported', 'the root folder cannot be deleted')
        await sftpRemove(sftpConfigOf(resolution, loc), loc.path)
        return
      }
      await ftpRemove(ftpConfig(resolution, loc), loc.path || '/', true)
    } catch (e) {
      throw mapError(e)
    }
  }

  async function rename(from: string, to: string): Promise<void> {
    const a = await resolved(from)
    const b = await resolved(to)
    if (remoteOriginKey(from) !== remoteOriginKey(to)) {
      throw new RemoteError('unsupported', 'renaming across two connections needs copy + delete')
    }
    if (await exists(to)) throw new RemoteError('exists', 'the destination already exists')
    try {
      if (a.loc.scheme === 's3') {
        const cfg = s3Config(a.resolution, a.loc)
        const st = await stat(from)
        if (!st) throw new RemoteError('not_found', 'the source does not exist')
        if (st.dir) {
          const copied = await s3CopyPrefix(cfg, a.loc.path, b.loc.path)
          if (copied.capped) throw new RemoteError('capped', 'the folder is too large to rename in one go')
          await s3Remove(cfg, a.loc.path, true)
        } else {
          await s3CopyObject(cfg, a.loc.path, b.loc.path)
          await s3DeleteObject(cfg, a.loc.path)
        }
        return
      }
      if (a.loc.scheme === 'sftp') {
        await sftpRename(sftpConfigOf(a.resolution, a.loc), a.loc.path, b.loc.path)
        return
      }
      await ftpRename(ftpConfig(a.resolution, a.loc), a.loc.path, b.loc.path)
    } catch (e) {
      throw mapError(e)
    }
  }

  async function readText(uri: string, maxBytes = 8_000_000): Promise<{ text: string; size: number } | { error: string }> {
    const st = await stat(uri).catch(() => null)
    if (!st || st.dir) return { error: 'not a file' }
    if (st.size > maxBytes) return { error: `file is larger than ${maxBytes} bytes` }
    const dir = await fs.mkdtemp(path.join(tempRoot, 'mfm-remote-'))
    const local = path.join(dir, 'read.bin')
    try {
      await downloadFile(uri, local)
      const buf = await fs.readFile(local)
      if (buf.subarray(0, 4096).includes(0)) return { error: 'this file is not text' }
      return { text: buf.toString('utf8'), size: buf.length }
    } catch (e) {
      return { error: mapError(e).message }
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async function writeBuffer(uri: string, data: Buffer): Promise<void> {
    const { loc, resolution } = await resolved(uri)
    try {
      if (loc.scheme === 's3') {
        const cfg = s3Config(resolution, loc)
        await s3PutBuffer(cfg, loc.path, data, 'application/octet-stream')
        return
      }
      const dir = await fs.mkdtemp(path.join(tempRoot, 'mfm-remote-'))
      const local = path.join(dir, 'write.bin')
      try {
        await fs.writeFile(local, data)
        if (loc.scheme === 'sftp') await sftpUpload(sftpConfigOf(resolution, loc), local, loc.path)
        else await ftpUpload(ftpConfig(resolution, loc), local, loc.path)
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
      }
    } catch (e) {
      throw mapError(e)
    }
  }

  async function writeText(uri: string, text: string): Promise<{ ok: true } | { error: string }> {
    const dir = await fs.mkdtemp(path.join(tempRoot, 'mfm-remote-'))
    const local = path.join(dir, 'write.bin')
    try {
      await fs.writeFile(local, text, 'utf8')
      await uploadFile(local, uri)
      return { ok: true }
    } catch (e) {
      return { error: mapError(e).message }
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async function properties(uri: string): Promise<Record<string, unknown>> {
    try {
      const st = await stat(uri)
      if (!st) return { error: 'not_found' }
      const loc = parseRemote(uri)
      if (!loc) return { error: 'bad_path' }
      let items: number | null = null
      if (st.dir) items = (await list(uri, true)).entries.length
      let size = st.size
      if (st.dir) {
        // the dialog shows «—» until the user asks for a recursive size; a remote folder is worse
        size = 0
      }
      return {
        name: st.name,
        path: uri,
        remote: true,
        protocol: remoteProtocolLabel(uri),
        dir: st.dir,
        size,
        ext: st.dir ? '' : extOf(st.name),
        mode: null,
        readable: true,
        writable: true,
        executable: false,
        uid: null,
        gid: null,
        user: '',
        group: '',
        nlink: 0,
        inode: 0,
        device: 0,
        birthtime: st.mtime,
        mtime: st.mtime,
        atime: st.mtime,
        ctime: st.mtime,
        link: !!st.link,
        symbolic: !!st.link,
        target: '',
        mime: st.dir ? 'inode/directory' : '',
        items,
        dims: null,
        location: remoteRoot(uri)
      }
    } catch (e) {
      return { error: mapError(e).message }
    }
  }

  /** Never overwrite an existing remote name: `name (2).ext` is the next free one. */
  async function freeName(uri: string): Promise<string> {
    if (!(await exists(uri))) return uri
    const dir = remoteDir(uri)
    const name = remoteName(uri)
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    for (let i = 2; i < 1000; i++) {
      const candidate = remoteJoin(dir, `${base} (${i})${ext}`)
      if (!(await exists(candidate))) return candidate
    }
    throw new RemoteError('exists', 'could not find a free name')
  }

  /** Test a profile without navigating (connection dialog). */
  async function test(uri: string): Promise<{ ok: true; detail: string }> {
    try {
      const listing = await list(uri, true)
      return { ok: true, detail: `${listing.entries.length} entries` }
    } catch (e) {
      const err = mapError(e)
      throw err
    }
  }

  return {
    isRemote: isRemotePath,
    list,
    dirs,
    stat,
    exists,
    measure,
    downloadFile,
    uploadFile,
    writeBuffer,
    mkdir,
    remove,
    rename,
    readText,
    writeText,
    properties,
    freeName,
    test,
    /** exposed for the transfer engine and MCP, which need the canonical remote path helpers */
    join: remoteJoin,
    name: remoteName,
    parent: remoteParent,
    pathOf: remotePathOf,
    root: remoteRoot,
    location: parseRemote,
    format: formatRemote
  }
}

export { posix as remotePosix }
