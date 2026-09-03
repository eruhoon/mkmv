const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// RPG Maker MV 워킹 디렉토리를 www 폴더로 변경 (플러그인 및 세이브 데이터 경로 일치)
const wwwDir = path.join(__dirname, 'www');
try {
  process.chdir(wwwDir);
} catch (e) {}

// Wayland & Ozone platform settings
app.commandLine.appendSwitch('ozone-platform', 'wayland');
app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');

// Hardware acceleration & GL settings
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    focusable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const indexPath = path.join(wwwDir, 'index.html');
  win.loadFile(indexPath);

  win.webContents.on('did-finish-load', () => {
    win.focus();
    win.webContents.focus();
  });

  win.on('closed', () => {
    app.quit();
  });
}

ipcMain.on('app-quit', () => {
  app.quit();
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
