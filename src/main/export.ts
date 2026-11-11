import { promises as fs } from 'node:fs'
import path from 'node:path'
import { freeName } from './ops.ts'
import { htmlToPdf } from './editor.ts'
import { toCsv, toHtmlTable, type ExportRow } from '../shared/export.ts'

export type { ExportRow } from '../shared/export.ts'
export { toCsv, toHtmlTable, rowsOf } from '../shared/export.ts'

/** Writes the listing next to the folder as CSV or PDF and returns the real path. */
export async function exportListing(
  dir: string,
  name: string,
  rows: ExportRow[],
  format: 'csv' | 'pdf',
  theme = 'dark'
): Promise<{ path: string; rows: number } | { error: string }> {
  if (!path.isAbsolute(dir)) return { error: 'مسیر نامعتبر' }
  const safe = String(name || 'listing').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60)
  if (format === 'csv') {
    const out = await freeName(path.join(dir, `${safe}.csv`))
    await fs.writeFile(out, toCsv(rows), 'utf8')
    return { path: out, rows: rows.length }
  }
  const out = await freeName(path.join(dir, `${safe}.pdf`))
  const r = await htmlToPdf(toHtmlTable(rows, safe), out, theme)
  return 'error' in r ? r : { path: r.path, rows: rows.length }
}
