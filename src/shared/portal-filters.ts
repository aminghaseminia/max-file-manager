export type PortalFilterRule = [kind: number, value: string]
export type PortalFilter = { name: string; rules: PortalFilterRule[] }

/** A small, dependency-free glob matcher for the portal's `*.png` / `photo_??.*` rules. */
export function globRegExp(glob: string): RegExp {
  let source = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') source += '.*'
    else if (c === '?') source += '.'
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1)
      if (end > i + 1) {
        const body = glob.slice(i + 1, end)
        const negated = body.startsWith('!') || body.startsWith('^')
        const clean = (negated ? body.slice(1) : body).replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
        source += `[${negated ? '^' : ''}${clean}]`
        i = end
      } else source += '\\['
    } else source += c.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
  }
  return new RegExp(source + '$', 'i')
}

const EXT_MIME: Record<string, string> = {
  avi: 'video/x-msvideo', bmp: 'image/bmp', css: 'text/css', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  gif: 'image/gif', htm: 'text/html', html: 'text/html', jpeg: 'image/jpeg', jpg: 'image/jpeg',
  js: 'text/javascript', json: 'application/json', md: 'text/markdown', mkv: 'video/x-matroska',
  mov: 'video/quicktime', mp3: 'audio/mpeg', mp4: 'video/mp4', mpeg: 'video/mpeg', odp: 'application/vnd.oasis.opendocument.presentation',
  ods: 'application/vnd.oasis.opendocument.spreadsheet', odt: 'application/vnd.oasis.opendocument.text',
  ogg: 'audio/ogg', pdf: 'application/pdf', png: 'image/png', ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', svg: 'image/svg+xml',
  tar: 'application/x-tar', text: 'text/plain', ts: 'video/mp2t', txt: 'text/plain', wav: 'audio/x-wav',
  webm: 'video/webm', webp: 'image/webp', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xml: 'application/xml', zip: 'application/zip'
}

export function matchesPortalFilter(name: string, ext: string, filter: PortalFilter | null): boolean {
  if (!filter || !filter.rules.length) return true
  const mime = EXT_MIME[ext.toLowerCase()] ?? 'application/octet-stream'
  return filter.rules.some(([kind, value]) => {
    if (!value) return false
    if (kind === 0) {
      try {
        return globRegExp(value).test(name)
      } catch {
        return false
      }
    }
    if (kind === 1) return value === mime || (value.endsWith('/*') && mime.startsWith(value.slice(0, -1)))
    return false
  })
}
