import { contextBridge, ipcRenderer } from 'electron'

// The whole main-process surface. Nothing else crosses the boundary.
contextBridge.exposeInMainWorld('api', {
  list: (dir: string, showHidden: boolean) => ipcRenderer.invoke('fs:list', dir, showHidden),
  roots: () => ipcRenderer.invoke('fs:roots'),
  home: () => ipcRenderer.invoke('fs:home'),
  op: (kind: string, paths: string[], dest?: string, name?: string) =>
    ipcRenderer.invoke('fs:op', { kind, paths, dest, name }),
  open: (p: string) => ipcRenderer.invoke('shell:open', p)
})
