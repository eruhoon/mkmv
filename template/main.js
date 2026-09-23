const { app, BrowserWindow, ipcMain, screen, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { createLogger, setLogLevel } = require(path.join(__dirname, 'modules', 'logger.js'));
const logger = createLogger('mkmv');

// Linux ext4 파일시스템 대소문자 불일치 404 방지 캐시 및 실시간 탐색기
const dirCache = new Map();

function getCaseInsensitiveChild(parentDir, childName) {
  let cache = dirCache.get(parentDir);
  let entries;
  if (!cache) {
    try {
      entries = fs.readdirSync(parentDir);
      cache = new Map();
      for (const entry of entries) {
        cache.set(entry.toLowerCase(), entry);
        try { cache.set(entry.normalize('NFC').toLowerCase(), entry); } catch (e) {}
        try { cache.set(entry.normalize('NFD').toLowerCase(), entry); } catch (e) {}
      }
      dirCache.set(parentDir, cache);
      dirCache.set(parentDir + ':entries', entries);
    } catch (e) {
      return null;
    }
  } else {
    entries = dirCache.get(parentDir + ':entries') || [];
  }

  const lowerChild = (childName || '').toLowerCase();
  let match = cache.get(lowerChild);
  if (!match) {
    try { match = cache.get((childName || '').normalize('NFC').toLowerCase()); } catch (e) {}
  }
  if (!match) {
    try { match = cache.get((childName || '').normalize('NFD').toLowerCase()); } catch (e) {}
  }

  // 1. 특수문자(일본어 점, 반각/전각 점, 언더바, 대시 등) 무시 정규화 비교
  if (!match && entries && entries.length > 0) {
    const stripPunct = s => s.toLowerCase().replace(/[\s・･·•\-_.\u30FB\uFF65\u00B7\u2022]/g, '');
    const cleanChild = stripPunct(childName || '');
    for (const entry of entries) {
      if (stripPunct(entry) === cleanChild) {
        match = entry;
        break;
      }
    }
  }

  // 2. 만약 여전히 없다면, 동일 확장자 내에서 알파벳 키워드 부분 일치 검사 (예: Skip.png, Auto.png)
  if (!match && entries && entries.length > 0) {
    const ext = path.extname(childName || '').toLowerCase();
    const base = path.basename(childName || '', ext).toLowerCase();
    const alphaMatch = base.match(/[a-z]{3,}/i);
    if (alphaMatch) {
      const keyword = alphaMatch[0].toLowerCase();
      const candidates = entries.filter(e => e.toLowerCase().endsWith(ext) && e.toLowerCase().includes(keyword));
      if (candidates.length === 1) {
        match = candidates[0];
      }
    }
  }

  return match || null;
}

function resolveCaseInsensitive(targetPath, baseDir = __dirname) {
  if (!targetPath || typeof targetPath !== 'string') return targetPath;
  targetPath = targetPath.replace(/\uFEFF/g, '');
  if (fs.existsSync(targetPath)) return targetPath;
  const normalizedTarget = path.resolve(targetPath);

  // 1. 단일 파일 레벨 빠른 대소문자/유니코드 매칭 (부모 폴더가 존재하는 경우 즉시 복구)
  const parentDir = path.dirname(normalizedTarget);
  if (fs.existsSync(parentDir)) {
    const filename = path.basename(normalizedTarget);
    const match = getCaseInsensitiveChild(parentDir, filename);
    if (match) return path.join(parentDir, match);
  }

  // 2. 심볼릭 링크(/roms <-> /storage/roms) 및 다단계 경로 계층 탐색
  let realBase = baseDir;
  try { realBase = fs.realpathSync(baseDir); } catch (e) {}
  const normalizedBase = path.resolve(realBase);

  let compareTarget = normalizedTarget;
  try {
    let p = parentDir;
    while (p && p !== path.dirname(p)) {
      if (fs.existsSync(p)) {
        compareTarget = path.join(fs.realpathSync(p), path.relative(p, normalizedTarget));
        break;
      }
      p = path.dirname(p);
    }
  } catch (e) {}

  if (compareTarget.startsWith(normalizedBase)) {
    let current = normalizedBase;
    const rel = path.relative(normalizedBase, compareTarget);
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

// 디렉토리 경로 분리 (공유 런타임 vs 게임 데이터)
const runtimeDir = __dirname;
let gameRootDir = process.env.MKMV_GAME_DIR || runtimeDir;

for (const arg of process.argv) {
  if (arg.startsWith('--game-dir=')) {
    const rawVal = arg.slice('--game-dir='.length);
    if (rawVal) gameRootDir = path.resolve(rawVal);
  }
}

// The same configuration resolver is used by preload.
const { loadConfig, resolveEffectiveEngine } = require(path.join(__dirname, 'modules', 'config.js'));
const opt = loadConfig(runtimeDir, gameRootDir);
logger.info('Effective performance settings:', JSON.stringify({
  performanceProfile: opt.effectiveProfile,
  lowMemoryMode: opt.lowMemoryMode,
  maxOldSpaceSize: opt.maxOldSpaceSize,
  gcIntervalSeconds: opt.gcIntervalSeconds,
  disableGpu: opt.disableGpu
}));

// 알만툴 MV / MZ 게임 디렉토리 격리 감지 (game/ 우선, 그 다음 www/, 최후 폴백으로 game/)
function detectGameDirectory(baseDir) {
  if (opt.gameDir) {
    const custom = path.resolve(baseDir, opt.gameDir);
    if (fs.existsSync(path.join(custom, 'index.html')) || fs.existsSync(custom)) {
      return custom;
    }
  }
  const candidates = ['game', 'www'];
  for (const sub of candidates) {
    const candidatePath = path.join(baseDir, sub);
    if (fs.existsSync(path.join(candidatePath, 'index.html'))) {
      return candidatePath;
    }
  }
  if (fs.existsSync(path.join(baseDir, 'index.html'))) {
    return baseDir;
  }
  return path.join(baseDir, 'game'); // 기본값
}

const gameDir = detectGameDirectory(gameRootDir);
const engineInfo = resolveEffectiveEngine(opt.engineVersion, gameDir, fs.existsSync);
const isMZ = engineInfo.isMZ;
logger.info(`Runtime Directory: ${runtimeDir}`);
logger.info(`Game Root Directory: ${gameRootDir}`);
logger.info(`Detected Game Engine: ${isMZ ? 'RPG Maker MZ' : 'RPG Maker MV'} (mode: ${engineInfo.mode}), Directory: ${gameDir}`);

try {
  process.chdir(gameDir);
} catch (e) {}

// V8 힙 제한 및 메모리 최적화
const maxHeap = Number(opt.maxOldSpaceSize) || (opt.lowMemoryMode ? 128 : 512);
logger.info(`Memory configuration: maxOldSpaceSize=${maxHeap}MB, lowMemoryMode=${opt.lowMemoryMode !== false}`);
app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${maxHeap} --expose-gc`);

if (opt.lowMemoryMode) {
  // 1GB RAM 저사양 기기(H700, RK3326 등)를 위한 크로미움 프로세스 및 캐시 제약
  app.commandLine.appendSwitch('renderer-process-limit', '1');
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disk-cache-size', String(opt.diskCacheSize || 1048576));
  app.commandLine.appendSwitch('media-cache-size', String(opt.mediaCacheSize || 1048576));
  // 백그라운드 태스크 및 네이티브 메모리 다이어트
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-breakpad');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('disable-sync');
  app.commandLine.appendSwitch('disable-translate');
  app.commandLine.appendSwitch('disable-features', 'AudioServiceSandbox,MediaRouter,PaintHolding');
} else {
  // 중/고사양 기기 (RG Vita Pro, RK3576, 2GB+ RAM): 넉넉한 캐시로 끊김 없는 에셋 로딩
  if (opt.rendererProcessLimit) {
    app.commandLine.appendSwitch('renderer-process-limit', String(opt.rendererProcessLimit));
  }
  if (opt.diskCacheSize) {
    app.commandLine.appendSwitch('disk-cache-size', String(opt.diskCacheSize));
  }
  if (opt.mediaCacheSize) {
    app.commandLine.appendSwitch('media-cache-size', String(opt.mediaCacheSize));
  }
}

// Wayland & Ozone platform settings + Out-of-process crash 방지를 위한 In-process Network Service
app.commandLine.appendSwitch('ozone-platform', 'wayland');
app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform,NetworkServiceInProcess');

// High-DPI & Scale factor settings (고해상도 디스플레이에서 배율 왜곡 방지)
app.commandLine.appendSwitch('high-dpi-support', '1');
if (opt.forceDeviceScaleFactor) {
  app.commandLine.appendSwitch('force-device-scale-factor', String(opt.forceDeviceScaleFactor));
}

// Hardware acceleration & GL settings
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (opt.disableGpu) {
  // 소프트웨어 CPU 렌더링 모드
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-gpu-rasterization');
} else {
  // 네이티브 하드웨어 GPU 가속 모드 (Mali-G52 WebGL 고속 렌더링)
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
}

function createWindow() {
  let winWidth = opt.width || 1920;
  let winHeight = opt.height || 1080;

  if (opt.autoDetectResolution !== false) {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      logger.debug('Detected primaryDisplay:', JSON.stringify(primaryDisplay ? primaryDisplay.bounds : null));
      if (primaryDisplay && primaryDisplay.bounds && primaryDisplay.bounds.width > 0 && primaryDisplay.bounds.height > 0) {
        winWidth = primaryDisplay.bounds.width;
        winHeight = primaryDisplay.bounds.height;
      }
    } catch (e) {
      logger.warn('Failed to get display bounds, using fallback:', e);
    }
  }

  logger.info(`Creating BrowserWindow: ${winWidth}x${winHeight}, fullscreen=${opt.fullscreen !== false}`);

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
      preload: path.join(runtimeDir, 'preload.js')
    }
  });

  // 플러그인(Community_Basic 등)에서 창 크기/위치 조정을 시도할 때 강제 차단
  win.setResizable(false);
  try { win.setMovable(false); } catch (e) {}
  win.on('will-resize', (e) => {
    logger.debug('Blocked renderer will-resize event');
    e.preventDefault();
  });

  if (opt.fullscreen !== false) {
    win.setFullScreen(true);
  }

  // 전체화면 토글(F4), 새로고침(F5, Ctrl+R) 등 임베디드 오작동 방지 및 입력 진단 로깅
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      const key = input.key ? input.key.toUpperCase() : '';
      logger.verbose(`keyDown: key="${input.key}", code="${input.code}"`);
      if (key === 'F4' || key === 'F5' || (input.control && key === 'R')) {
        event.preventDefault();
      }
    }
  });

  const indexPath = path.join(gameDir, 'index.html');
  logger.info('Loading game file:', indexPath);
  win.loadFile(indexPath);

  win.webContents.on('did-finish-load', () => {
    try {
      win.webContents.setZoomFactor(opt.forceDeviceScaleFactor || 1);
    } catch (e) {}
    logger.info('Content loaded, focusing window');
    win.focus();
    win.webContents.focus();
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logger.error(`did-fail-load: ${errorCode} (${errorDescription}) on ${validatedURL}`);
  });

  win.webContents.on('render-process-gone', (event, details) => {
    logger.error(`Render process gone! Reason: ${details.reason}, ExitCode: ${details.exitCode}`);
  });

  win.webContents.on('plugin-crashed', (event, name, version) => {
    logger.error(`Plugin crashed: ${name} v${version}`);
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
      let rawPath = new URL(request.url).pathname;
      let pathname = decodeURIComponent(rawPath).replace(/\uFEFF/g, '');
      if (process.platform === 'win32' && pathname.startsWith('/') && pathname.length > 2 && pathname[2] === ':') {
        pathname = pathname.slice(1);
      }
      const resolved = resolveCaseInsensitive(pathname, gameDir);
      logger.verbose(`interceptFile: "${pathname}" -> "${resolved}"`);
      callback({ path: resolved });
    } catch (e) {
      logger.error(`[mkmv-protocol-error] URL: ${request.url}`, e);
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
