import { contextBridge, ipcRenderer } from 'electron'
import type { BrowserState, Invoke } from '../shared/model'
const invoke: Invoke = (command, ...args) =>
  ipcRenderer.invoke('desk', command, ...args)
contextBridge.exposeInMainWorld('desk', {
  invoke,
  onBrowser(callback: (state: BrowserState) => void) {
    const listener = (_event: unknown, state: BrowserState) => callback(state)
    ipcRenderer.on('browser-state', listener)
    return () => ipcRenderer.removeListener('browser-state', listener)
  }
})
