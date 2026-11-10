import { contextBridge, ipcRenderer } from 'electron'

// The whole main-process surface. Nothing else crosses the boundary.
contextBridge.exposeInMainWorld('api', {
  list: (dir: string, showHidden: boolean) => ipcRenderer.invoke('fs:list', dir, showHidden),
  dirs: (dir: string) => ipcRenderer.invoke('fs:dirs', dir),
  roots: () => ipcRenderer.invoke('fs:roots'),
  home: () => ipcRenderer.invoke('fs:home'),
  size: (p: string) => ipcRenderer.invoke('fs:size', p),
  op: (kind: string, paths: string[], dest?: string, name?: string) =>
    ipcRenderer.invoke('fs:op', { kind, paths, dest, name }),
  open: (p: string) => ipcRenderer.invoke('shell:open', p),
  state: {
    get: () => ipcRenderer.invoke('state:get'),
    set: (s: unknown) => ipcRenderer.invoke('state:set', s)
  }
})
