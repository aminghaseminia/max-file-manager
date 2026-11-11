import { BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Same font the app uses, inlined so the PDF looks like the screen without touching the system. */
async function fontFaces(): Promise<string> {
  const dir = path.join(process.cwd(), 'node_modules/vazirmatn/fonts/webfonts')
  const pick = async (file: string, weight: number) => {
    const buf = await fs.readFile(path.join(dir, file)).catch(() => null)
    if (!buf) return ''
    return `@font-face{font-family:Vazirmatn;font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2')}`
  }
  return (await pick('Vazirmatn-Regular.woff2', 400)) + (await pick('Vazirmatn-Bold.woff2', 700))
}

const isDark = (theme: string) => theme !== 'light'

/** Paper CSS: A4-ish margins, RTL by default, code blocks left-to-right. */
export async function printCss(theme = 'dark'): Promise<string> {
  const dark = isDark(theme)
  return `${await fontFaces()}
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body {
  font-family: Vazirmatn, 'Segoe UI', Tahoma, sans-serif;
  font-size: 11.5pt; line-height: 1.85; color: ${dark ? '#e8eaf0' : '#1c1f26'};
  background: ${dark ? '#14161c' : '#fff'}; margin: 0; padding: 0;
}
h1,h2,h3,h4 { line-height: 1.45; margin: 1.1em 0 .5em; }
h1 { font-size: 1.7em; } h2 { font-size: 1.35em; } h3 { font-size: 1.15em; }
p, li, blockquote, td, th { text-align: start; }
a { color: ${dark ? '#7aa7ff' : '#1a56c4'}; text-decoration: none; }
blockquote { margin: .8em 0; padding: .3em 1em; border-inline-start: 3px solid #5b93ff; color: ${dark ? '#b8bfcc' : '#4a5160'}; }
pre { direction: ltr; text-align: left; margin: .8em 0; padding: .8em 1em; border-radius: 6px;
  background: ${dark ? '#1b1e26' : '#f4f6fa'}; border: 1px solid ${dark ? '#2b3040' : '#e2e6ee'};
  white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
code { direction: ltr; unicode-bidi: embed; font-family: ui-monospace, 'DejaVu Sans Mono', monospace; font-size: .92em; }
:not(pre) > code { background: ${dark ? '#22262f' : '#eef1f6'}; padding: .1em .35em; border-radius: 4px; }
table { border-collapse: collapse; width: 100%; margin: .8em 0; }
td, th { border: 1px solid ${dark ? '#2b3040' : '#dde2ea'}; padding: .35em .6em; }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid ${dark ? '#2b3040' : '#dde2ea'}; }
.hljs-comment,.hljs-quote{color:#7e8797;font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-literal{color:${dark ? '#c678dd' : '#7c3aed'}}
.hljs-string,.hljs-attr{color:${dark ? '#98c379' : '#0f7b3f'}}
.hljs-number,.hljs-built_in{color:${dark ? '#d19a66' : '#b45309'}}
.hljs-title,.hljs-function,.hljs-section{color:${dark ? '#61afef' : '#1a56c4'}}
.hljs-variable,.hljs-template-variable,.hljs-type{color:${dark ? '#e5c07b' : '#8a5b00'}}
.hljs-tag,.hljs-name{color:${dark ? '#e06c75' : '#b91c1c'}}
.hljs-meta{color:${dark ? '#56b6c2' : '#0e7490'}}
`
}

/** Renders prepared HTML in a hidden window and prints it to `out`. */
export async function htmlToPdf(
  html: string,
  out: string,
  theme = 'dark'
): Promise<{ path: string } | { error: string }> {
  if (!path.isAbsolute(out)) return { error: 'مسیر نامعتبر' }
  const css = await printCss(theme)
  const doc = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, sandbox: true }
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(doc))
    const buf = await win.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    await fs.mkdir(path.dirname(out), { recursive: true })
    await fs.writeFile(out, buf)
    return { path: out }
  } catch (e: any) {
    return { error: String(e?.message ?? e) }
  } finally {
    win.destroy()
  }
}

/** Plain text edit save: temp file then rename, so a crash never leaves half a document. */
export async function writeTextFile(p: string, text: string): Promise<{ ok: true } | { error: string }> {
  if (!path.isAbsolute(p)) return { error: 'مسیر نامعتبر' }
  const st = await fs.stat(p).catch(() => null)
  if (st && st.size > 8_000_000) return { error: 'فایل بزرگ‌تر از ۸ مگابایت است' }
  const tmp = `${p}.mfm-tmp-${process.pid}`
  try {
    await fs.writeFile(tmp, text, 'utf8')
    if (st) await fs.chmod(tmp, st.mode).catch(() => {})
    await fs.rename(tmp, p)
    return { ok: true }
  } catch (e: any) {
    await fs.rm(tmp, { force: true })
    return { error: String(e?.message ?? e) }
  }
}

/** Text for the editor: a hard size ceiling keeps a stray 2 GB log from freezing the UI. */
export async function readTextFile(p: string): Promise<{ text: string; size: number } | { error: string }> {
  if (!path.isAbsolute(p)) return { error: 'مسیر نامعتبر' }
  const st = await fs.stat(p).catch(() => null)
  if (!st || st.isDirectory()) return { error: 'فایل نیست' }
  if (st.size > 8_000_000) return { error: 'فایل بزرگ‌تر از ۸ مگابایت است؛ با ویرایشگر باز نمی‌شود' }
  const buf = await fs.readFile(p).catch(() => null)
  if (!buf) return { error: 'خواندن فایل ممکن نشد' }
  // a NUL in the head means binary; the editor would only show broken characters
  if (buf.subarray(0, 4096).includes(0)) return { error: 'این فایل متنی نیست' }
  return { text: buf.toString('utf8'), size: st.size }
}
