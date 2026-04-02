const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  getApiBaseUrl: () => ipcRenderer.invoke('app:get-api-base-url'),
  selectDbFile: () => ipcRenderer.invoke('app:select-db-file'),
  selectMediaFolder: () => ipcRenderer.invoke('app:select-media-folder'),
});
