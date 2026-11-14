/**
 * A `mfm://` / `thumb://` request path back to a real file.
 *
 * `mediaUrl()` builds `mfm://local/C:/dir/file.png`, so the URL pathname is `/C:/dir/file.png`.
 * That leading slash makes the path *relative* to Node on Windows (`path.isAbsolute('/C:/x')` is
 * false), so every image and thumbnail was rejected with «bad path» and the viewer stayed empty.
 */
export function mediaPathFromUrl(raw: string): string {
  let pathname = ''
  try {
    pathname = decodeURIComponent(new URL(raw).pathname)
  } catch {
    return ''
  }
  // `/C:/dir/file.png` → `C:/dir/file.png`; a POSIX path keeps its leading slash
  return /^\/[A-Za-z]:([\\/]|$)/.test(pathname) ? pathname.slice(1) : pathname
}
