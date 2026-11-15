import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

/**
 * A deliberately small `~/.ssh/config` reader. Enough for the connection dialog: one row per
 * concrete host alias with the host name, user, port and identity file OpenSSH would use.
 *
 * `Include`, `Match`, `ProxyJump` and `ProxyCommand` are ignored (and documented as such); this is
 * an import helper, not a second SSH client configuration engine.
 */
export type SshConfigHost = {
  alias: string
  host: string
  user: string
  port: number
  /** expanded absolute identity file, '' when the config did not name one */
  identityFile: string
}

type Block = { patterns: string[]; values: Map<string, string[]> }

const WILDCARD = /[*?!]/

/** Quote-aware split: OpenSSH values may be quoted and may contain `#` inside quotes. */
function words(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = null
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === '#') break
    if (/\s/.test(c)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += c
  }
  if (cur) out.push(cur)
  return out
}

/** OpenSSH `~`, `%d` and `%h`/`%r`/`%u` expansion (enough for identity files). */
export function expandSshPath(
  value: string,
  opts: { home?: string; host?: string; user?: string; localUser?: string } = {}
): string {
  const home = opts.home ?? os.homedir()
  const localUser = opts.localUser ?? os.userInfo().username
  let out = String(value ?? '').trim()
  if (!out) return ''
  if (out === '~') out = home
  else if (out.startsWith('~/')) out = path.join(home, out.slice(2))
  out = out
    .replace(/%d/g, home)
    .replace(/%h/g, opts.host ?? '')
    .replace(/%r/g, opts.user ?? '')
    .replace(/%u/g, localUser)
    .replace(/%%/g, '%')
  return out
}

function parseBlocks(text: string): { blocks: Block[]; globals: Map<string, string[]> } {
  const blocks: Block[] = []
  let current: Block | null = null
  const globals = new Map<string, string[]>()

  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(line)
    const parts = eq ? [eq[1], ...words(eq[2])] : words(line)
    if (!parts.length) continue
    const key = parts[0].toLowerCase()
    const values = parts.slice(1)
    if (key === 'host') {
      current = { patterns: values, values: new Map() }
      blocks.push(current)
      continue
    }
    if (key === 'match') {
      current = null
      continue
    }
    if (key === 'include') continue
    if (!current) {
      if (!globals.has(key)) globals.set(key, values)
      continue
    }
    if (!current.values.has(key)) current.values.set(key, values)
    if (current.patterns.some((p) => p === '*')) {
      if (!globals.has(key)) globals.set(key, values)
    }
  }
  return { blocks, globals }
}

function first(map: Map<string, string[]>, key: string): string {
  return map.get(key)?.[0] ?? ''
}

export function parseSshConfig(
  text: string,
  opts: { home?: string; localUser?: string; defaultUser?: string; defaultPort?: number } = {}
): SshConfigHost[] {
  const home = opts.home ?? os.homedir()
  const localUser = opts.localUser ?? os.userInfo().username
  const { blocks, globals } = parseBlocks(text)
  const out: SshConfigHost[] = []
  const seen = new Set<string>()

  for (const block of blocks) {
    if (block.patterns.some((p) => WILDCARD.test(p))) continue
    for (const alias of block.patterns) {
      if (!alias || seen.has(alias)) continue
      seen.add(alias)
      const host = first(block.values, 'hostname') || first(globals, 'hostname') || alias
      const user = first(block.values, 'user') || first(globals, 'user') || opts.defaultUser || localUser
      const portRaw = first(block.values, 'port') || first(globals, 'port')
      const portNum = Number(portRaw)
      const port = Number.isInteger(portNum) && portNum > 0 && portNum <= 65535 ? portNum : opts.defaultPort || 22
      const identityRaw = first(block.values, 'identityfile') || first(globals, 'identityfile')
      const identityFile = identityRaw ? expandSshPath(identityRaw, { home, host, user, localUser }) : ''
      out.push({ alias, host, user, port, identityFile })
    }
  }
  return out.sort((a, b) => a.alias.localeCompare(b.alias))
}

/** The host key fingerprint format OpenSSH prints: `SHA256:` + unpadded base64. */
export function fingerprintSha256(key: Buffer): string {
  const hash = createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  return `SHA256:${hash}`
}
