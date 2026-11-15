import { createHmac } from 'node:crypto'

/**
 * `known_hosts` verification for the SFTP client. The app does not shell out to `ssh`, so the
 * file is read and matched here: plain and hashed (`|1|salt|hash`) host entries, `[host]:port`
 * entries, wildcards, `!` negation and `@revoked` markers.
 *
 * `@cert-authority` entries cannot be validated without a full certificate implementation, so a
 * matching CA is treated as *unknown* (never as trusted) and the dialog asks for a fingerprint.
 */
export type KnownHostEntry = {
  marker: '' | '@revoked' | '@cert-authority'
  /** raw pattern list exactly as written (comma separated in the file) */
  patterns: string[]
  keyType: string
  /** base64 of the public key blob */
  key: string
}

export type KnownHostVerdict = 'trusted' | 'revoked' | 'unknown'

export function parseKnownHosts(text: string): KnownHostEntry[] {
  const out: KnownHostEntry[] = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    let rest = line
    let marker: KnownHostEntry['marker'] = ''
    if (rest.startsWith('@')) {
      const i = rest.indexOf(' ')
      if (i < 0) continue
      const m = rest.slice(0, i).toLowerCase()
      rest = rest.slice(i + 1).trim()
      if (m === '@revoked') marker = '@revoked'
      else if (m === '@cert-authority') marker = '@cert-authority'
      else continue
    }
    const parts = rest.split(/\s+/)
    if (parts.length < 3) continue
    out.push({ marker, patterns: parts[0].split(','), keyType: parts[1], key: parts[2] })
  }
  return out
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

function hashedHostMatches(encoded: string, candidate: string): boolean {
  const parts = encoded.split('|')
  if (parts.length !== 4 || parts[1] !== '1') return false
  try {
    const salt = Buffer.from(parts[2], 'base64')
    const expected = Buffer.from(parts[3], 'base64')
    const got = createHmac('sha1', salt).update(candidate).digest()
    return got.length === expected.length && got.equals(expected)
  } catch {
    return false
  }
}

export function hostPatternMatches(patterns: string[], host: string, port: number): boolean {
  const h = host.toLowerCase()
  const candidates = port === 22 ? [h, `[${h}]:22`] : [`[${h}]:${port}`]
  let positive = false
  for (const raw of patterns) {
    const negated = raw.startsWith('!')
    const pattern = negated ? raw.slice(1) : raw
    if (!pattern) continue
    let hit = false
    if (pattern.startsWith('|1|')) {
      hit = candidates.some((c) => hashedHostMatches(pattern, c))
    } else if (pattern.startsWith('[')) {
      // [host]:port — matched literally (the port is already inside the pattern)
      hit = candidates.some((c) => globToRegExp(pattern).test(c))
    } else {
      hit = port === 22 && globToRegExp(pattern).test(h)
    }
    if (hit && negated) return false
    if (hit) positive = true
  }
  return positive
}

/** Does the file trust this exact public-key blob for this host and port? */
export function knownHostVerdict(
  text: string,
  host: string,
  port: number,
  keyBase64: string
): KnownHostVerdict {
  let trusted = false
  for (const entry of parseKnownHosts(text)) {
    if (entry.key !== keyBase64) continue
    if (!hostPatternMatches(entry.patterns, host, port)) continue
    if (entry.marker === '@revoked') return 'revoked'
    if (entry.marker === '@cert-authority') continue
    trusted = true
  }
  return trusted ? 'trusted' : 'unknown'
}

/** Entries (of any key) that claim this host, used to spot a changed host key. */
export function knownHostEntriesFor(text: string, host: string, port: number): KnownHostEntry[] {
  return parseKnownHosts(text).filter(
    (e) => e.marker !== '@cert-authority' && hostPatternMatches(e.patterns, host, port)
  )
}
