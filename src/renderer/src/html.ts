/**
 * HTML files are previewed, never executed: scripts are stripped here and the frame is sandboxed
 * without `allow-scripts`, so even a missed pattern cannot run.
 */
export function cleanHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*>/gi, '')
    .replace(/<(iframe|object|embed|frame|frameset)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"')
    .replace(/javascript:/gi, '')
}

export const isHtmlPath = (p: string): boolean => /\.(html?|xhtml)$/i.test(p)
