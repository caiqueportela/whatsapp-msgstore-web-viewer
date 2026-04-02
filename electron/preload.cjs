const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  getApiBaseUrl: () => ipcRenderer.invoke('app:get-api-base-url'),
  selectDbFile: () => ipcRenderer.invoke('app:select-db-file'),
  selectMediaFolder: () => ipcRenderer.invoke('app:select-media-folder'),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
});
