const path = require('path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { startBackendServer } = require('./backend.cjs');

let backendState = null;

const isDev = !app.isPackaged;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0b141a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

async function setupBackend() {
  backendState = await startBackendServer();

  ipcMain.handle('app:get-api-base-url', async () => backendState.baseUrl);

  ipcMain.handle('app:select-db-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Selecionar msgstore.db',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle('app:select-media-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Selecionar pasta de mídias do WhatsApp',
      properties: ['openDirectory'],
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return result.filePaths[0];
  });
}

app.whenReady().then(async () => {
  await setupBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (backendState?.close) {
    await backendState.close();
  }
});
