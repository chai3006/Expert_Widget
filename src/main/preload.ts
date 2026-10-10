// Preload (sandboxed): exposes only the calls the UI needs as `window.expert`.
// Must stay self-contained: a sandboxed preload can only require 'electron'.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ExpertApi, Theme, ViewModel } from '../shared/types.js';

const api: ExpertApi = {
  getView: () => ipcRenderer.invoke('view:get'),
  refresh: () => ipcRenderer.invoke('view:refresh'),
  markVisited: (companyKey: string) => ipcRenderer.invoke('interact:visited', companyKey),
  markSeen: (newsId: string) => ipcRenderer.invoke('interact:seen', newsId),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open', url),
  setTheme: (theme: Theme) => ipcRenderer.invoke('ui:theme', theme),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  onView: (callback: (view: ViewModel) => void) => {
    const listener = (_event: IpcRendererEvent, view: ViewModel) => callback(view);
    ipcRenderer.on('view:update', listener);
    return () => ipcRenderer.removeListener('view:update', listener);
  },
};

contextBridge.exposeInMainWorld('expert', api);
