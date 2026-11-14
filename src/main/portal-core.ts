import path from 'node:path'
import { pathToFileURL } from 'node:url'

export { globRegExp, matchesPortalFilter } from '../shared/portal-filters.ts'
export type { PortalFilter, PortalFilterRule } from '../shared/portal-filters.ts'

/** XDG sends paths as NUL-terminated byte arrays, not as strings. */
export function portalPath(value: unknown): string | null {
  let bytes: number[] = []
  if (value instanceof Uint8Array) bytes = [...value]
  else if (Array.isArray(value) && value.every((n) => typeof n === 'number')) bytes = value as number[]
  else if (typeof value === 'string') return path.isAbsolute(value) ? value : null
  else return null
  while (bytes.at(-1) === 0) bytes.pop()
  if (!bytes.length) return null
  const decoded = Buffer.from(bytes).toString('utf8').replace(/\0/g, '')
  return path.isAbsolute(decoded) ? path.normalize(decoded) : null
}

export function fileUri(p: string): string {
  return pathToFileURL(p).toString()
}

/** Add/remove only MFM's backend token; every other preference and fallback stays untouched. */
export function updatePortalsConf(text: string, enabled: boolean): string {
  const key = 'org.freedesktop.impl.portal.FileChooser'
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
  if (lines.length === 1 && lines[0] === '') lines.pop()
  while (lines.length > 1 && lines.at(-1) === '') lines.pop()
  let section = ''
  let preferred = -1
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*\[([^\]]+)\]\s*$/)
    if (match) {
      section = match[1].trim()
      if (section === 'preferred' && preferred < 0) preferred = i
    }
  }
  if (preferred < 0) {
    if (!enabled) return lines.length ? lines.join('\n') + '\n' : ''
    if (lines.length && lines.at(-1) !== '') lines.push('')
    lines.push('[preferred]', `${key}=mfm;`)
    return lines.join('\n') + '\n'
  }

  let end = lines.length
  for (let i = preferred + 1; i < lines.length; i++) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i])) {
      end = i
      break
    }
  }
  let found = -1
  for (let i = preferred + 1; i < end; i++) {
    if (new RegExp(`^\\s*${key.replace(/\./g, '\\.')}\\s*=`).test(lines[i])) {
      found = i
      break
    }
  }
  const old = found < 0 ? '' : lines[found].slice(lines[found].indexOf('=') + 1)
  const backends = old.split(';').map((s) => s.trim()).filter((s) => s && s !== 'mfm')
  if (enabled) backends.unshift('mfm')
  const replacement = backends.length ? `${key}=${backends.join(';')};` : ''
  if (found >= 0) {
    if (replacement) lines[found] = replacement
    else lines.splice(found, 1)
  } else if (replacement) lines.splice(preferred + 1, 0, replacement)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
}

/** GLib parses D-Bus service Exec lines with shell-style quoting, but never runs a shell. */
export function dbusExecQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
