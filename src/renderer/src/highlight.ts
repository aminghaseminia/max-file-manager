import hljs from 'highlight.js/lib/common'

/** extension → highlight.js language; anything unknown is shown as plain text. */
const BY_EXT: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  ini: 'ini',
  toml: 'ini',
  sql: 'sql',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  pl: 'perl',
  lua: 'lua',
  diff: 'diff',
  patch: 'diff',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  cmake: 'cmake',
  gradle: 'groovy',
  swift: 'swift'
}

export const langFor = (p: string): string | null => {
  const name = p.split(/[\\/]/).pop() ?? ''
  const lower = name.toLowerCase()
  if (BY_EXT[lower]) return BY_EXT[lower]
  const ext = lower.includes('.') ? lower.split('.').pop()! : ''
  return BY_EXT[ext] ?? null
}

/** highlight.js output is escaped HTML, safe to inject; unknown languages pass through escaped. */
export function highlightCode(code: string, lang: string | null): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch {
      /* fall through to plain */
    }
  }
  return escapeHtml(code)
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
