/**
 * Direction handling taken from the portal's markdown renderer: every block gets its own `dir`
 * from its first strong character, and code is always left-to-right no matter what language the
 * surrounding text is in.
 */
export const RTL_CHAR_RX =
  /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u200F]/

export const hasRtl = (text: string | null | undefined): boolean => !!text && RTL_CHAR_RX.test(text)

export const dirOfText = (text: string | null | undefined): 'rtl' | 'ltr' =>
  hasRtl(text) ? 'rtl' : 'ltr'

const BLOCKS = 'p, li, ul, ol, table, td, th, h1, h2, h3, h4, h5, h6, blockquote, dd, dt'

function forceCodeLtr(doc: Document): void {
  doc.querySelectorAll('pre').forEach((pre) => {
    pre.setAttribute('dir', 'ltr')
    pre.querySelectorAll('code').forEach((code) => code.setAttribute('dir', 'ltr'))
  })
}

/** Sets `dir` on the markup itself so it survives any stylesheet. */
export function applyAutoDirection(html: string): string {
  if (!html) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll(BLOCKS).forEach((el) => {
    el.setAttribute('dir', hasRtl(el.textContent) ? 'rtl' : 'ltr')
  })
  forceCodeLtr(doc)
  return doc.body.innerHTML
}

export function forceCodeBlocksLtr(html: string): string {
  if (!html) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  forceCodeLtr(doc)
  return doc.body.innerHTML
}
