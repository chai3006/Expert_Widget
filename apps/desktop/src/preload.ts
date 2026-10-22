// Preload (sandboxed): exposes only the calls the UI needs as `window.expert`.
// Must stay self-contained: a sandboxed preload can only require 'electron'.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ExpertApi, Theme, ViewModel, WindowMode } from '../../../packages/core/src/shared/types.js';

const api: ExpertApi = {
  getView: () => ipcRenderer.invoke('view:get'),
  refresh: () => ipcRenderer.invoke('view:refresh'),
  markVisited: (companyKey: string) => ipcRenderer.invoke('interact:visited', companyKey),
  markSeen: (newsId: string) => ipcRenderer.invoke('interact:seen', newsId),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open', url),
  removeNews: (newsId: string) => ipcRenderer.invoke('feedback:remove', newsId),
  undoRemove: (newsId: string) => ipcRenderer.invoke('feedback:undo-remove', newsId),
  toggleUseful: (newsId: string) => ipcRenderer.invoke('feedback:useful', newsId),
  setTheme: (theme: Theme) => ipcRenderer.invoke('ui:theme', theme),
  setMode: (mode: WindowMode) => ipcRenderer.invoke('window:mode', mode),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  // Fire-and-forget messages: pointer moves are frequent and need no answer.
  dragStart: () => ipcRenderer.send('drag:start'),
  dragMove: () => ipcRenderer.send('drag:move'),
  dragEnd: () => ipcRenderer.send('drag:end'),
  onView: (callback: (view: ViewModel) => void) => {
    const listener = (_event: IpcRendererEvent, view: ViewModel) => callback(view);
    ipcRenderer.on('view:update', listener);
    return () => ipcRenderer.removeListener('view:update', listener);
  },
};

contextBridge.exposeInMainWorld('expert', api);
