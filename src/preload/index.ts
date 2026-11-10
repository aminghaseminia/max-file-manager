import { contextBridge, ipcRenderer } from 'electron'

// The whole main-process surface. Nothing else crosses the boundary.
contextBridge.exposeInMainWorld('api', {
  list: (dir: string, showHidden: boolean) => ipcRenderer.invoke('fs:list', dir, showHidden),
  dirs: (dir: string) => ipcRenderer.invoke('fs:dirs', dir),
  roots: () => ipcRenderer.invoke('fs:roots'),
  home: () => ipcRenderer.invoke('fs:home'),
  size: (p: string) => ipcRenderer.invoke('fs:size', p),
  remove: (paths: string[], permanent: boolean) =>
    ipcRenderer.invoke('fs:remove', { paths, permanent }),
  walk: (dir: string, opts: unknown) => ipcRenderer.invoke('fs:walk', dir, opts),
  dupes: (dir: string) => ipcRenderer.invoke('fs:dupes', dir),
  archive: (p: string) => ipcRenderer.invoke('fs:archive', p),
  extract: (archive: string, names: string[], dest: string) =>
    ipcRenderer.invoke('fs:extract', { archive, names, dest }),
  getMeta: (dir: string) => ipcRenderer.invoke('meta:get', dir),
  setMeta: (dir: string, meta: unknown) => ipcRenderer.invoke('meta:set', { dir, meta }),
  iconThemes: (extra: string[]) => ipcRenderer.invoke('icons:themes', extra),
  iconsIn: (themeDir: string) => ipcRenderer.invoke('icons:in', themeDir),
  mkdir: (dir: string, name: string) => ipcRenderer.invoke('fs:mkdir', dir, name),
  renameMany: (pairs: { from: string; to: string }[]) => ipcRenderer.invoke('fs:renameMany', pairs),
  open: (p: string) => ipcRenderer.invoke('shell:open', p),
  jobs: {
    start: (kind: string, sources: string[], dest: string) =>
      ipcRenderer.invoke('job:start', { kind, sources, dest }),
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
  undo: { run: () => ipcRenderer.invoke('undo:run'), depth: () => ipcRenderer.invoke('undo:depth') },
  window: {
    minimize: () => ipcRenderer.invoke('window:control', 'minimize'),
    maximize: () => ipcRenderer.invoke('window:control', 'maximize'),
    close: () => ipcRenderer.invoke('window:control', 'close'),
    isMaximized: () => ipcRenderer.invoke('window:isMax'),
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
