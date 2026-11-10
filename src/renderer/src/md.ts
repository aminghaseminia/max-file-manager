import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import { applyAutoDirection, dirOfText } from './direction'
import { highlightCode } from './highlight'

const marked = new Marked({ gfm: true, breaks: true })

// fenced code goes through highlight.js, everything else stays as marked wrote it
marked.use({
  renderer: {
    code({ text, lang }) {
      const out = highlightCode(text, lang || null)
      const cls = lang ? ` class="hljs language-${lang}"` : ' class="hljs"'
      return `<pre dir="ltr"><code dir="ltr"${cls}>${out}</code></pre>\n`
    }
  }
})

/**
 * markdown → sanitized HTML with per-block direction. Everything the editor shows and everything
 * the PDF export prints goes through here, so both always agree.
 */
export function renderMarkdown(text: string): string {
  const raw = marked.parse(text || '') as string
  return applyAutoDirection(DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } }))
}

export const firstDir = (text: string): 'rtl' | 'ltr' => dirOfText(text)
