import type { Entry } from '../main/types.ts'

export type ExportRow = {
  name: string
  size: number
  mtime: number
  type: string
  label: string
  rating: number
  note: string
}

const esc = (v: string) => (/[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)

/** CSV with a UTF-8 BOM so Excel opens Persian correctly. */
export function toCsv(rows: ExportRow[]): string {
  const head = ['name', 'size', 'modified', 'type', 'label', 'rating', 'note']
  const body = rows.map((r) =>
    [
      esc(r.name),
      String(r.size),
      new Date(r.mtime).toISOString(),
      esc(r.type),
      esc(r.label),
      String(r.rating || ''),
      esc(r.note)
    ].join(',')
  )
  return '\ufeff' + [head.join(','), ...body].join('\r\n') + '\r\n'
}

const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const human = (n: number) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`
}

/** Printable HTML table; the PDF export reuses the app's own print CSS. */
export function toHtmlTable(rows: ExportRow[], title: string): string {
  const trs = rows
    .map(
      (r) =>
        `<tr><td>${escHtml(r.name)}</td><td dir="ltr">${escHtml(human(r.size))}</td>` +
        `<td dir="ltr">${new Date(r.mtime).toISOString().slice(0, 16).replace('T', ' ')}</td>` +
        `<td>${escHtml(r.type)}</td><td>${escHtml(r.label)}</td>` +
        `<td>${r.rating ? '★'.repeat(r.rating) : ''}</td><td>${escHtml(r.note)}</td></tr>`
    )
    .join('')
  return (
    `<h2>${escHtml(title)}</h2>` +
    `<p>${rows.length} مورد</p>` +
    `<table><thead><tr><th>نام</th><th>اندازه</th><th>تاریخ</th><th>نوع</th><th>برچسب</th><th>امتیاز</th><th>توضیح</th></tr></thead>` +
    `<tbody>${trs}</tbody></table>`
  )
}

/** Builds export rows from the pane's entries plus the folder metadata. */
export function rowsOf(
  entries: Entry[],
  meta: {
    labels?: Record<string, string>
    ratings?: Record<string, number>
    notes?: Record<string, string>
  },
  labelName: (id: string) => string
): ExportRow[] {
  return entries.map((e) => ({
    name: e.name,
    size: e.size,
    mtime: e.mtime,
    type: e.dir ? 'folder' : e.ext || 'file',
    label: labelName(meta.labels?.[e.name] ?? ''),
    rating: meta.ratings?.[e.name] ?? 0,
    note: meta.notes?.[e.name] ?? ''
  }))
}
