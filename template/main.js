const { app, BrowserWindow, ipcMain, screen, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

// Linux ext4 파일시스템 대소문자 불일치 404 방지 캐시 및 실시간 탐색기
const dirCache = new Map();

function getCaseInsensitiveChild(parentDir, childName) {
  let cache = dirCache.get(parentDir);
  if (!cache) {
    try {
      const entries = fs.readdirSync(parentDir);
      cache = new Map();
      for (const entry of entries) {
        cache.set(entry.toLowerCase(), entry);
      }
      dirCache.set(parentDir, cache);
    } catch (e) {
      return null;
    }
  }
  return cache.get(childName.toLowerCase()) || null;
}

function resolveCaseInsensitive(targetPath, baseDir = __dirname) {
  if (!targetPath || typeof targetPath !== 'string') return targetPath;
  if (fs.existsSync(targetPath)) return targetPath;
  const normalizedTarget = path.resolve(targetPath);
  const normalizedBase = path.resolve(baseDir);

  if (normalizedTarget.startsWith(normalizedBase)) {
    let current = normalizedBase;
    const rel = path.relative(normalizedBase, normalizedTarget);
    const relParts = rel.split(/[/\\]+/).filter(Boolean);
    for (const part of relParts) {
      const match = getCaseInsensitiveChild(current, part);
      if (!match) return targetPath;
      current = path.join(current, match);
    }
    return current;
  }
  return targetPath;
}

// 사용자 정의 옵션 (config.json) 로드
let opt = {
  width: 1920,
  height: 1080,
  fullscreen: true,
  autoDetectResolution: true,
  forceDeviceScaleFactor: 1.0,
  pixelated: true,
  scaling: 'fit',
  disableGpu: true,
  hideCursor: false,
  disableTouch: false,
  showFps: false,
  fastForward: false,
  fastForwardSpeed: 2,
  lowMemoryMode: false
};

try {
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    opt = Object.assign(opt, JSON.parse(raw));
  }
} catch (e) {
  console.error('[mkmv] config.json load error:', e);
}

// RPG Maker MV 워킹 디렉토리를 www 폴더로 변경 (플러그인 및 세이브 데이터 경로 일치)
const wwwDir = path.join(__dirname, 'www');
try {
  process.chdir(wwwDir);
} catch (e) {}

// 저사양 1GB 기기용 메모리 제한 모드 (OOM 킬러 방지)
if (opt.lowMemoryMode) {
  console.log('[mkmv] lowMemoryMode enabled: restricting V8 heap to 512MB');
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
}

// Wayland & Ozone platform settings
app.commandLine.appendSwitch('ozone-platform', 'wayland');
app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');

// High-DPI & Scale factor settings (고해상도 디스플레이에서 배율 왜곡 방지)
app.commandLine.appendSwitch('high-dpi-support', '1');
if (opt.forceDeviceScaleFactor) {
  app.commandLine.appendSwitch('force-device-scale-factor', String(opt.forceDeviceScaleFactor));
}

// Hardware acceleration & GL settings (Mali-G52 세그폴트 방지)
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (opt.disableGpu !== false) {
  // Mali Bifrost(RK3576) Wayland 드라이버 세그폴트 방지: 안정적인 CPU 렌더링 모드
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
} else {
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}

function createWindow() {
  let winWidth = opt.width || 1920;
  let winHeight = opt.height || 1080;

  if (opt.autoDetectResolution !== false) {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      console.log('[mkmv] Detected primaryDisplay:', JSON.stringify(primaryDisplay ? primaryDisplay.bounds : null));
      if (primaryDisplay && primaryDisplay.bounds && primaryDisplay.bounds.width > 0 && primaryDisplay.bounds.height > 0) {
        winWidth = primaryDisplay.bounds.width;
        winHeight = primaryDisplay.bounds.height;
      }
    } catch (e) {
      console.warn('[mkmv] Failed to get display bounds, using fallback:', e);
    }
  }

  console.log(`[mkmv] Creating BrowserWindow: ${winWidth}x${winHeight}, fullscreen=${opt.fullscreen !== false}`);

  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    fullscreen: opt.fullscreen !== false,
    resizable: false,
    useContentSize: true,
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

  // 플러그인(Community_Basic 등)에서 창 크기 조정을 시도할 때 강제 차단
  win.on('will-resize', (e) => {
    console.log('[mkmv] Blocked renderer will-resize event');
    e.preventDefault();
  });

  if (opt.fullscreen !== false) {
    win.setFullScreen(true);
  }

  // 전체화면 토글(F4), 새로고침(F5, Ctrl+R) 등 임베디드 오작동 방지
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      const key = input.key ? input.key.toUpperCase() : '';
      if (key === 'F4' || key === 'F5' || (input.control && key === 'R')) {
        event.preventDefault();
      }
    }
  });

  const indexPath = path.join(wwwDir, 'index.html');
  win.loadFile(indexPath);

  win.webContents.on('did-finish-load', () => {
    try {
      win.webContents.setZoomFactor(opt.forceDeviceScaleFactor || 1);
    } catch (e) {}
    console.log('[mkmv] Content loaded, focusing window');
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
  // Linux ext4 대소문자 불일치 404 방지: file:// 프로토콜 가로채기
  protocol.interceptFileProtocol('file', (request, callback) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url).pathname);
      if (process.platform === 'win32' && pathname.startsWith('/') && pathname.length > 2 && pathname[2] === ':') {
        pathname = pathname.slice(1);
      }
      const resolved = resolveCaseInsensitive(pathname, __dirname);
      callback({ path: resolved });
    } catch (e) {
      callback({ error: -6 }); // net::ERR_FILE_NOT_FOUND
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
