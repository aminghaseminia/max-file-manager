import { contextBridge, ipcRenderer, webUtils } from 'electron'

// The whole main-process surface. Nothing else crosses the boundary.
contextBridge.exposeInMainWorld('api', {
  list: (dir: string, showHidden: boolean, dims = false) =>
    ipcRenderer.invoke('fs:list', dir, showHidden, dims),
  statfs: (p: string) => ipcRenderer.invoke('fs:statfs', p),
  imageData: (p: string) => ipcRenderer.invoke('fs:imageData', p),
  saveImage: (src: string, dataUrl: string, mode: string) =>
    ipcRenderer.invoke('image:save', { src, dataUrl, mode }),
  dirs: (dir: string) => ipcRenderer.invoke('fs:dirs', dir),
  roots: () => ipcRenderer.invoke('fs:roots'),
  home: () => ipcRenderer.invoke('fs:home'),
  size: (p: string) => ipcRenderer.invoke('fs:size', p),
  remove: (paths: string[], permanent: boolean) =>
    ipcRenderer.invoke('fs:remove', { paths, permanent }),
  walk: (dir: string, opts: unknown) => ipcRenderer.invoke('fs:walk', dir, opts),
  dupes: (dir: string) => ipcRenderer.invoke('fs:dupes', dir),
  archive: (p: string) => ipcRenderer.invoke('fs:archive', p),
  registerHotkey: (accel: string) => ipcRenderer.invoke('hotkey:register', accel),
  runScript: (command: string, path?: string, dir?: string) =>
    ipcRenderer.invoke('app:runScript', { command, path, dir }),
  openTerminal: (dir: string) => ipcRenderer.invoke('app:terminal', dir),
  reveal: (path: string) => ipcRenderer.invoke('app:reveal', path),
  dragOut: (files: string[]) => ipcRenderer.send('app:dragOut', files),
  clearThumbs: () => ipcRenderer.invoke('thumbs:clear'),
  search: {
    index: (cfg: unknown) => ipcRenderer.invoke('search:index', cfg),
    query: (query: string, limit?: number) => ipcRenderer.invoke('search:query', { query, limit }),
    stats: () => ipcRenderer.invoke('search:stats'),
    clear: () => ipcRenderer.invoke('search:clear'),
    onProgress: (cb: (p: unknown) => void) => {
      const fn = (_e: unknown, p: unknown) => cb(p)
      ipcRenderer.on('search:progress', fn)
      return () => ipcRenderer.removeListener('search:progress', fn)
    }
  },
  tags: (paths: string[]) => ipcRenderer.invoke('fs:tags', paths),
  writeTags: (path: string, fields: unknown) => ipcRenderer.invoke('meta:writeTags', { path, fields }),
  saveImageAs: (src: string, dataUrl: string) => ipcRenderer.invoke('image:saveAs', { src, dataUrl }),
  convertImages: (files: string[], opts: unknown) =>
    ipcRenderer.invoke('image:batchConvert', { files, opts }),
  exportListing: (dir: string, name: string, rows: unknown, format: string, theme?: string) =>
    ipcRenderer.invoke('export:listing', { dir, name, rows, format, theme }),
  syncCompare: (left: string, right: string, opts?: unknown) =>
    ipcRenderer.invoke('sync:compare', { left, right, ...(opts as object) }),
  syncApply: (left: string, right: string, rows: unknown, mode: string, deleteExtra?: boolean) =>
    ipcRenderer.invoke('sync:apply', { left, right, rows, mode, deleteExtra }),
  diffFiles: (a: string, b: string) => ipcRenderer.invoke('fs:diff', { a, b }),
  readText: (p: string) => ipcRenderer.invoke('fs:readText', p),
  writeText: (path: string, text: string) => ipcRenderer.invoke('fs:writeText', { path, text }),
  htmlToPdf: (html: string, out: string, theme?: string) =>
    ipcRenderer.invoke('pdf:html', { html, out, theme }),
  createArchive: (dir: string, name: string, sources: string[], level?: number) =>
    ipcRenderer.invoke('fs:archiveCreate', { dir, name, sources, level }),
  extract: (archive: string, names: string[], dest: string) =>
    ipcRenderer.invoke('fs:extract', { archive, names, dest }),
  getMeta: (dir: string) => ipcRenderer.invoke('meta:get', dir),
  labelPalette: () => ipcRenderer.invoke('meta:labels'),
  setFormat: (dir: string, format: unknown) => ipcRenderer.invoke('meta:setFormat', { dir, format }),
  setRating: (dir: string, name: string, stars: number) =>
    ipcRenderer.invoke('meta:setRating', { dir, name, stars }),
  setNote: (dir: string, name: string, text: string) =>
    ipcRenderer.invoke('meta:setNote', { dir, name, text }),
  setLabel: (dir: string, name: string, label: string | null) =>
    ipcRenderer.invoke('meta:setLabel', { dir, name, label }),
  togglePin: (dir: string, name: string, on?: boolean) =>
    ipcRenderer.invoke('meta:togglePin', { dir, name, on }),
  setMeta: (dir: string, meta: unknown) => ipcRenderer.invoke('meta:set', { dir, meta }),
  iconThemes: (extra: string[]) => ipcRenderer.invoke('icons:themes', extra),
  iconsIn: (themeDir: string) => ipcRenderer.invoke('icons:in', themeDir),
  mkdir: (dir: string, name: string) => ipcRenderer.invoke('fs:mkdir', dir, name),
  renameMany: (pairs: { from: string; to: string }[]) => ipcRenderer.invoke('fs:renameMany', pairs),
  open: (p: string) => ipcRenderer.invoke('shell:open', p),
  preview: (p: string) => ipcRenderer.invoke('fs:preview', p),
  hash: (paths: string[], algo: string) => ipcRenderer.invoke('fs:hash', paths, algo),
  // a dropped File only becomes a path here, in preload
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  jobs: {
    start: (kind: string, sources: string[], dest: string, opts?: unknown) =>
      ipcRenderer.invoke('job:start', { kind, sources, dest, opts }),
    pause: (id: string) => ipcRenderer.invoke('job:pause', id),
    resume: (id: string) => ipcRenderer.invoke('job:resume', id),
    cancel: (id: string) => ipcRenderer.invoke('job:cancel', id),
    list: () => ipcRenderer.invoke('job:list'),
    clear: () => ipcRenderer.invoke('job:clear'),
    onUpdate: (cb: (job: unknown) => void) => {
      const fn = (_e: unknown, job: unknown) => cb(job)
      ipcRenderer.on('job:update', fn)
      return () => ipcRenderer.removeListener('job:update', fn)
    }
  },
  app: {
    onOpenPath: (cb: (p: string) => void) => {
      const fn = (_e: unknown, p: string) => cb(p)
      ipcRenderer.on('app:open-path', fn)
      return () => ipcRenderer.removeListener('app:open-path', fn)
    }
  },
  undo: { run: () => ipcRenderer.invoke('undo:run'), depth: () => ipcRenderer.invoke('undo:depth') },
  window: {
    minimize: () => ipcRenderer.invoke('window:control', 'minimize'),
    maximize: () => ipcRenderer.invoke('window:control', 'maximize'),
    close: () => ipcRenderer.invoke('window:control', 'close'),
    isMaximized: () => ipcRenderer.invoke('window:isMax'),
    setFullscreen: (on: boolean) => ipcRenderer.invoke('window:fullscreen', on),
    getChrome: () => ipcRenderer.invoke('window:getChrome'),
    setChrome: (c: { customTitlebar: boolean; rounded: boolean }) =>
      ipcRenderer.invoke('window:setChrome', c),
    onMaximized: (cb: (max: boolean) => void) => {
      const fn = (_e: unknown, max: boolean) => cb(max)
      ipcRenderer.on('window:maximized', fn)
      return () => ipcRenderer.removeListener('window:maximized', fn)
    }
  },
  state: {
    get: () => ipcRenderer.invoke('state:get'),
    set: (s: unknown) => ipcRenderer.invoke('state:set', s)
  }
})
