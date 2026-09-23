console.log('[mkmv-preload] Preload script initializing...');
process.on('uncaughtException', (err) => {
  console.error('[mkmv-preload uncaughtException]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[mkmv-preload unhandledRejection]', reason);
});

const Module = require('module');
const path = require('path');
const fs = require('fs');
const originalRequire = Module.prototype.require;

// 외부 모듈 로드 (키/입력 및 이미지 로딩 전담 모듈)
const { setupInputModule } = require(path.join(__dirname, 'modules', 'input.js'));
const { setupImageLoader } = require(path.join(__dirname, 'modules', 'image-loader.js'));

// 원본 fs 메서드 백업 (재귀 호출 방지 및 고속 직접 접근용)
const origExistsSync = fs.existsSync;
const origReadFileSync = fs.readFileSync;
const origReadFile = fs.readFile;
const origStatSync = fs.statSync;
const origReaddirSync = fs.readdirSync;
const origWriteFileSync = fs.writeFileSync;
const origRenameSync = fs.renameSync;
const origCopyFileSync = fs.copyFileSync;
const origOpenSync = fs.openSync;
const origWriteSync = fs.writeSync;
const origFsyncSync = fs.fsyncSync;
const origCloseSync = fs.closeSync;
const origMkdirSync = fs.mkdirSync;

// 1. RPG Maker MV & MZ 작업 디렉토리 및 메인 모듈 경로 자동 감지
const runtimeDir = __dirname;
let gameRootDir = process.env.MKMV_GAME_DIR || runtimeDir;

for (const arg of process.argv) {
  if (arg.startsWith('--game-dir=')) {
    const rawVal = arg.slice('--game-dir='.length);
    if (rawVal) gameRootDir = path.resolve(rawVal);
  }
}

function detectGameDirectory(baseDir) {
  const candidates = ['game', 'www'];
  for (const sub of candidates) {
    const candidatePath = path.join(baseDir, sub);
    if (origExistsSync.call(fs, path.join(candidatePath, 'index.html'))) {
      return candidatePath;
    }
  }
  if (origExistsSync.call(fs, path.join(baseDir, 'index.html'))) {
    return baseDir;
  }
  return path.join(baseDir, 'www'); // 기본값
}

const gameDir = detectGameDirectory(gameRootDir);
const isMZ = origExistsSync.call(fs, path.join(gameDir, 'js', 'rmmz_core.js'));

try {
  process.chdir(gameDir);
} catch (e) {}

// Linux ext4 파일시스템 대소문자 불일치 대응 (Node.js fs API 가상화)
const dirCache = new Map();

function getCaseInsensitiveChild(parentDir, childName) {
  let cache = dirCache.get(parentDir);
  let entries;
  if (!cache) {
    try {
      entries = origReaddirSync.call(fs, parentDir);
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

  // 2. 동일 확장자 내에서 알파벳 키워드 부분 일치 검사 (예: Skip.png, Auto.png)
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

  // 3. 확장자가 다른 동일 이름 미디어 파일 (.ogg <-> .m4a, .png <-> .rpgmvp / .png_)
  if (!match && entries && entries.length > 0) {
    const ext = path.extname(childName || '').toLowerCase();
    const base = path.basename(childName || '', ext).toLowerCase();
    let altExts = [];
    if (ext === '.ogg') altExts = ['.m4a', '.rpgmvo', '.ogg_'];
    else if (ext === '.m4a') altExts = ['.ogg', '.rpgmvm', '.m4a_'];
    else if (ext === '.png') altExts = ['.rpgmvp', '.png_'];

    for (const altExt of altExts) {
      const altChild = (base + altExt).toLowerCase();
      const found = cache.get(altChild);
      if (found) {
        match = found;
        break;
      }
    }
  }

  return match || null;
}

function resolveCaseInsensitive(targetPath, baseDir = gameDir) {
  if (!targetPath || typeof targetPath !== 'string') return targetPath;
  targetPath = targetPath.replace(/\uFEFF/g, '');
  let normalizedTarget = path.resolve(baseDir, targetPath);
  if (!origExistsSync.call(fs, normalizedTarget) && targetPath.startsWith('/')) {
    const candidate = path.resolve(baseDir, targetPath.replace(/^\/+/, ''));
    if (origExistsSync.call(fs, candidate)) {
      normalizedTarget = candidate;
    }
  }
  if (origExistsSync.call(fs, normalizedTarget)) return normalizedTarget;

  // 1. 단일 파일 레벨 빠른 대소문자/유니코드 매칭
  const parentDir = path.dirname(normalizedTarget);
  if (origExistsSync.call(fs, parentDir)) {
    const filename = path.basename(normalizedTarget);
    const match = getCaseInsensitiveChild(parentDir, filename);
    if (match) return path.join(parentDir, match);
  }

  // 2. 심볼릭 링크 및 다단계 경로 계층 탐색
  let realBase = baseDir;
  try { realBase = fs.realpathSync(baseDir); } catch (e) {}
  const normalizedBase = path.resolve(realBase);

  let compareTarget = normalizedTarget;
  try {
    let p = parentDir;
    while (p && p !== path.dirname(p)) {
      if (origExistsSync.call(fs, p)) {
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

// 게임 내 URL을 디스크 절대 경로로 정규화
function resolveGamePath(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') return null;
  if (inputUrl.startsWith('data:') || inputUrl.startsWith('blob:')) return null;
  let target = inputUrl.replace(/\uFEFF/g, '');
  if (target.startsWith('file://')) {
    try {
      target = new URL(target).pathname;
    } catch (e) {
      target = target.replace(/^file:\/\//, '');
    }
  }
  try {
    target = decodeURIComponent(target);
  } catch (e) {}

  if (process.platform === 'win32' && target.startsWith('/') && target.length > 2 && target[2] === ':') {
    target = target.slice(1);
  }

  return resolveCaseInsensitive(target, gameDir);
}

// Chromium C++ FileURLLoaderFactory 버그 대응: 유니코드/특수문자 파일의 XMLHttpRequest 및 fetch 직접 복구
function setupUniversalXhrRecovery() {
  if (typeof XMLHttpRequest === 'undefined') return;
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    this._mkmvMethod = (method || 'GET').toUpperCase();
    this._mkmvUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const url = this._mkmvUrl;
    const method = this._mkmvMethod;

    if (method === 'GET' && typeof url === 'string' && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:') && !url.startsWith('blob:')) {
      const resolved = resolveGamePath(url);
      const exists = resolved && origExistsSync.call(fs, resolved);
      const hasSpecial = /[^\x00-\x7F]/.test(url) || (resolved && /[^\x00-\x7F]/.test(resolved)) || url.includes('%');

      if (hasSpecial && exists) {
        const self = this;
        setTimeout(() => {
          try {
            const isArrayBuffer = self.responseType === 'arraybuffer';
            const isJson = self.responseType === 'json';
            const isBlob = self.responseType === 'blob';

            let responseData;
            let responseText = '';

            if (isArrayBuffer) {
              const buf = origReadFileSync.call(fs, resolved);
              responseData = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            } else if (isBlob) {
              const buf = origReadFileSync.call(fs, resolved);
              responseData = new Blob([buf]);
            } else {
              responseText = origReadFileSync.call(fs, resolved, 'utf8').replace(/^\uFEFF/, '');
              if (isJson) {
                try {
                  responseData = JSON.parse(responseText);
                } catch (e) {
                  responseData = null;
                }
              } else {
                responseData = responseText;
              }
            }

            Object.defineProperty(self, 'readyState', { value: 4, writable: false, configurable: true });
            Object.defineProperty(self, 'status', { value: 200, writable: false, configurable: true });
            Object.defineProperty(self, 'statusText', { value: 'OK', writable: false, configurable: true });
            Object.defineProperty(self, 'response', { value: responseData, writable: false, configurable: true });
            if (!isArrayBuffer && !isBlob) {
              Object.defineProperty(self, 'responseText', { value: responseText, writable: false, configurable: true });
            }

            if (typeof self.onreadystatechange === 'function') {
              self.onreadystatechange();
            }
            self.dispatchEvent(new Event('readystatechange'));

            if (typeof self.onload === 'function') {
              self.onload();
            }
            self.dispatchEvent(new ProgressEvent('load'));

            if (typeof self.onloadend === 'function') {
              self.onloadend();
            }
            self.dispatchEvent(new ProgressEvent('loadend'));
          } catch (err) {
            console.error('[mkmv-preload] XHR direct fulfill error:', err);
            if (typeof self.onerror === 'function') {
              self.onerror();
            }
            self.dispatchEvent(new ProgressEvent('error'));
          }
        }, 0);
        return;
      }
    }

    return origSend.apply(this, arguments);
  };

  if (typeof window !== 'undefined' && window.fetch) {
    const origFetch = window.fetch;
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:') && !url.startsWith('blob:')) {
        const resolved = resolveGamePath(url);
        const exists = resolved && origExistsSync.call(fs, resolved);
        const hasSpecial = /[^\x00-\x7F]/.test(url) || (resolved && /[^\x00-\x7F]/.test(resolved)) || url.includes('%');
        if (hasSpecial && exists) {
          try {
            const buf = origReadFileSync.call(fs, resolved);
            return Promise.resolve(new Response(buf, { status: 200, statusText: 'OK' }));
          } catch (e) {}
        }
      }
      return origFetch.apply(this, arguments);
    };
  }

  console.log('[mkmv-preload] Universal XHR & Fetch Unicode recovery installed');
}
setupUniversalXhrRecovery();

// 2. Node.js fs 가상화 패치
fs.existsSync = function(p) {
  try {
    return origExistsSync.call(fs, resolveCaseInsensitive(p, gameDir));
  } catch (e) {
    return origExistsSync.call(fs, p);
  }
};

fs.readFileSync = function(p, options) {
  const resolved = resolveCaseInsensitive(p, gameDir);
  let content;
  try {
    content = origReadFileSync.call(fs, resolved, options);
  } catch (err) {
    if (typeof p === 'string' && (p === 'lng.txt' || p.endsWith('/lng.txt') || p.endsWith('\\lng.txt'))) {
      console.warn(`[mkmv-preload] Missing ${p} detected, automatically generating fallback language 'ko'`);
      try {
        origWriteFileSync.call(fs, resolved, 'ko', 'utf8');
      } catch (e) {}
      return 'ko';
    }
    throw err;
  }

  if (typeof p === 'string' && (p === 'lng.txt' || p.endsWith('/lng.txt') || p.endsWith('\\lng.txt'))) {
    if (typeof content === 'string') {
      content = content.replace(/^\uFEFF/, '').trim();
    } else if (Buffer.isBuffer(content)) {
      const str = content.toString('utf8').replace(/^\uFEFF/, '').trim();
      content = options ? str : Buffer.from(str, 'utf8');
    }
  }

  // 0바이트 손상 세이브 파일 자동 복구 (.bak)
  if (typeof p === 'string' && (p.endsWith('.rpgsave') || p.endsWith('.rmmzsave')) && (!content || content.length === 0)) {
    const saveDir = path.dirname(resolved);
    const fileName = path.basename(resolved);
    const hiddenBakFile = path.join(saveDir, '.bak', fileName + '.bak');
    const legacyBakFile = resolved + '.bak';
    const targetBak = origExistsSync.call(fs, hiddenBakFile) ? hiddenBakFile : (origExistsSync.call(fs, legacyBakFile) ? legacyBakFile : null);

    if (targetBak) {
      console.warn(`[mkmv-preload] Corrupted 0-byte save detected for ${p}, restoring from ${targetBak}`);
      try {
        content = origReadFileSync.call(fs, targetBak, options);
      } catch (e) {}
    }
  }
  return content;
};

fs.statSync = function(p, options) {
  return origStatSync.call(fs, resolveCaseInsensitive(p, gameDir), options);
};

fs.readFile = function(p, ...args) {
  return origReadFile.call(fs, resolveCaseInsensitive(p, gameDir), ...args);
};

// 세이브 파일 파손 방지 (원자적 쓰기 + 물리 SD 카드 fsync 플러시 + .bak 서브폴더 자동 백업)
fs.writeFileSync = function(p, data, options) {
  const resolvedPath = resolveCaseInsensitive(p, gameDir);
  const isSaveFile = typeof p === 'string' && (
    p.endsWith('.rpgsave') || 
    p.endsWith('.rmmzsave') || 
    p.includes('/save/') || 
    p.includes('\\save\\')
  );

  if (isSaveFile) {
    try {
      if (origExistsSync.call(fs, resolvedPath)) {
        try {
          const saveDir = path.dirname(resolvedPath);
          const bakDir = path.join(saveDir, '.bak');
          if (!origExistsSync.call(fs, bakDir)) {
            origMkdirSync.call(fs, bakDir, { recursive: true });
          }
          origCopyFileSync.call(fs, resolvedPath, path.join(bakDir, path.basename(resolvedPath) + '.bak'));
        } catch (e) {}
      }

      const tmpPath = resolvedPath + '.tmp.' + Date.now();
      const fd = origOpenSync.call(fs, tmpPath, 'w');
      try {
        origWriteSync.call(fs, fd, data);
        try { origFsyncSync.call(fs, fd); } catch (e) {}
      } finally {
        try { origCloseSync.call(fs, fd); } catch (e) {}
      }

      origRenameSync.call(fs, tmpPath, resolvedPath);
      return;
    } catch (err) {
      console.warn('[mkmv-preload] Atomic save failed, falling back to direct write:', err);
    }
  }
  return origWriteFileSync.call(fs, resolvedPath, data, options);
};

// 3. 사용자 정의 옵션 (mkmv.json / config.json) 로드
const { loadConfig } = require(path.join(__dirname, 'modules', 'config.js'));
const userOpt = loadConfig(runtimeDir, gameRootDir);

if (!process.mainModule) {
  process.mainModule = { filename: path.join(gameDir, 'index.html') };
} else {
  process.mainModule.filename = path.join(gameDir, 'index.html');
}

// 4. 모듈 초기화 (키/입력 핸들러 및 이미지 로더)
setupInputModule({ userOpt, isMZ });
setupImageLoader({ resolveGamePath, origExistsSync, origReadFileSync, gameDir });

// 5. NW.js 호환성 객체 (알만툴 MV & MZ 필수 모듈 Shim)
const nwShim = {
  App: {
    argv: [],
    fullPath: gameDir,
    dataPath: gameDir,
    quit: () => {
      try {
        require('electron').ipcRenderer.send('app-quit');
      } catch (e) {
        window.close();
      }
    }
  },
  Window: {
    get: () => ({
      x: 0,
      y: 0,
      width: window.innerWidth || window.screen.width || userOpt.width || 1920,
      height: window.innerHeight || window.screen.height || userOpt.height || 1080,
      isFullScreen: true,
      showDevTools: () => {},
      close: () => {
        try {
          require('electron').ipcRenderer.send('app-quit');
        } catch (e) {
          window.close();
        }
      },
      maximize: () => {},
      unmaximize: () => {},
      minimize: () => {},
      restore: () => {},
      enterFullscreen: () => {},
      leaveFullscreen: () => {},
      toggleFullscreen: () => {},
      resizeTo: (w, h) => {
        console.log('[mkmv-preload] Intercepted nw.Window.get().resizeTo:', w, h);
      },
      resizeBy: (dw, dh) => {
        console.log('[mkmv-preload] Intercepted nw.Window.get().resizeBy:', dw, dh);
      },
      moveTo: () => {},
      moveBy: () => {},
      focus: () => {},
      blur: () => {},
      on: () => {},
      menu: null
    })
  },
  Menu: function() { this.append = () => {}; },
  MenuItem: function() {},
  Tray: function() {},
  Shell: {
    openExternal: (url) => {
      try {
        require('electron').shell.openExternal(url);
      } catch (e) {}
    },
    openItem: () => {},
    showItemInFolder: () => {}
  }
};

// Steamworks (greenworks) Shim
const greenworksShim = {
  init: () => false,
  initAPI: () => false,
  isSteamRunning: () => false,
  getAppId: () => 0,
  activateAchievement: () => {},
  getAchievement: () => false,
  clearAchievement: () => {},
  getNumberOfPlayers: () => 0,
  activateGameOverlay: () => {},
  isGameOverlayEnabled: () => false,
  on: () => {},
  _events: {},
  ugcGetItems: () => {},
  ugcGetUserItems: () => {}
};

Module.prototype.require = function(id) {
  if (id === 'nw.gui') {
    return nwShim;
  }
  if (typeof id === 'string' && id.includes('greenworks')) {
    return greenworksShim;
  }
  return originalRequire.apply(this, arguments);
};

window.nw = nwShim;
window.nwGui = nwShim;
window.greenworks = greenworksShim;

// 브라우저 창 크기 및 위치 강제 변경 방지 (Yanfly CoreEngine 스크립트 화면 축소 차단)
const blockWindowResize = () => {
  const noop = function() {};
  try {
    Object.defineProperty(window, 'resizeTo', { value: noop, writable: false, configurable: true });
    Object.defineProperty(window, 'resizeBy', { value: noop, writable: false, configurable: true });
    Object.defineProperty(window, 'moveTo', { value: noop, writable: false, configurable: true });
    Object.defineProperty(window, 'moveBy', { value: noop, writable: false, configurable: true });
  } catch (e) {
    window.resizeTo = noop;
    window.resizeBy = noop;
    window.moveTo = noop;
    window.moveBy = noop;
  }
};
blockWindowResize();

// 플러그인 해상도 강제 재설정 방지
window.Imported = window.Imported || {};
window.Imported.ScreenResolution = true;

const yanflyGuardTimer = setInterval(() => {
  if (window.Yanfly && window.Yanfly.updateResolution) {
    window.Yanfly.updateResolution = function() {
      console.log('[mkmv-preload] Blocked Yanfly.updateResolution()');
    };
    clearInterval(yanflyGuardTimer);
  }
}, 30);
setTimeout(() => clearInterval(yanflyGuardTimer), 15000);

// NW.js 환경 식별 버전 주입
if (!process.versions['node-webkit']) {
  process.versions['node-webkit'] = '0.13.0';
}
if (!process.versions['nw']) {
  process.versions['nw'] = '0.13.0';
}
if (!process.versions['nw-flavor']) {
  process.versions['nw-flavor'] = 'normal';
}

// 6. 알만툴 오디오 포커스 아웃 음소거 방지
function patchAudioFocus() {
  if (window.WebAudio) {
    window.WebAudio._onVisibilityChange = function() {};
  }
  if (window.AudioManager) {
    window.AudioManager._onVisibilityChange = function() {};
  }
}

const audioPollTimer = setInterval(() => {
  if (window.WebAudio || window.AudioManager) {
    patchAudioFocus();
    clearInterval(audioPollTimer);
  }
}, 30);
setTimeout(() => clearInterval(audioPollTimer), 10000);

// 7. 고해상도 스케일링 및 픽셀 선명도 보정 CSS 주입
function injectResolutionStyles() {
  const style = document.createElement('style');
  style.id = 'mkmv-resolution-fix';
  let cssText = `
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      overflow: hidden !important;
      background-color: #000000 !important;
    }
  `;
  if (userOpt.pixelated !== false) {
    cssText += `
    #GameCanvas, #UpperCanvas, canvas {
      image-rendering: -webkit-optimize-contrast !important;
      image-rendering: crisp-edges !important;
      image-rendering: pixelated !important;
    }
    `;
  }
  cssText += `
    #GameCanvas {
      z-index: 1 !important;
    }
    #UpperCanvas {
      z-index: 2 !important;
    }
    #mkmv-keymap-debug, #mkmv-fps-counter, #mkmv-fast-forward {
      z-index: 2147483647 !important;
      position: absolute !important;
      transform: translateZ(9999px) !important;
      will-change: transform !important;
    }
  `;
  style.textContent = cssText;
  if (document.head) {
    document.head.appendChild(style);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.head) document.head.appendChild(style);
    });
  }
}
injectResolutionStyles();

// 알만툴 Graphics 엔진 실시간 스케일링 패치
function patchGraphics() {
  if (!window.Graphics) return;

  window.Graphics._defaultStretchMode = function() { return true; };
  window.Graphics._stretchEnabled = true;

  const isFillOrStretch = (userOpt.scaling === 'fill' || userOpt.scaling === 'stretch');

  window.Graphics._updateRealScale = function() {
    this._stretchEnabled = true;
    if (isFillOrStretch) {
      this._realScale = 1;
    } else {
      const h = window.innerWidth / (this._width || 1);
      const v = window.innerHeight / (this._height || 1);
      this._realScale = Math.min(h, v);
    }
  };

  window.Graphics._centerElement = function(element) {
    if (!element) return;
    element.style.position = 'absolute';
    element.style.margin = 'auto';
    element.style.top = '0px';
    element.style.left = '0px';
    element.style.right = '0px';
    element.style.bottom = '0px';

    if (isFillOrStretch) {
      element.style.width = window.innerWidth + 'px';
      element.style.height = window.innerHeight + 'px';
    } else {
      const baseW = (element.width !== undefined && element.width > 0) ? element.width : (window.Graphics._width || 1920);
      const baseH = (element.height !== undefined && element.height > 0) ? element.height : (window.Graphics._height || 1080);
      const width = Math.round(baseW * this._realScale);
      const height = Math.round(baseH * this._realScale);
      element.style.width = width + 'px';
      element.style.height = height + 'px';
    }
  };

  if (isFillOrStretch) {
    window.Graphics.pageToCanvasX = function(x) {
      if (this._canvas) {
        return Math.round(x * (this._width / window.innerWidth));
      }
      return 0;
    };
    window.Graphics.pageToCanvasY = function(y) {
      if (this._canvas) {
        return Math.round(y * (this._height / window.innerHeight));
      }
      return 0;
    };
  }

  if (typeof window.Graphics._updateAllElements === 'function' && window.Graphics._canvas && window.Graphics._errorPrinter) {
    window.Graphics._updateAllElements();
  }
}

const gTimer = setInterval(() => {
  if (window.Graphics) {
    patchGraphics();
    clearInterval(gTimer);
  }
}, 30);
setTimeout(() => clearInterval(gTimer), 10000);

const smTimer = setInterval(() => {
  if (window.SceneManager && window.SceneManager.run) {
    const origRun = window.SceneManager.run;
    window.SceneManager.run = function(sceneClass) {
      patchGraphics();
      const res = origRun.apply(this, arguments);
      patchGraphics();
      if (window.Graphics && typeof window.Graphics._updateAllElements === 'function') {
        window.Graphics._updateAllElements();
      }
      return res;
    };
    clearInterval(smTimer);
  }
}, 30);
setTimeout(() => clearInterval(smTimer), 15000);

window.addEventListener('load', () => {
  setTimeout(() => {
    patchGraphics();
    if (window.Graphics && typeof window.Graphics._updateAllElements === 'function' && window.Graphics._canvas && window.Graphics._errorPrinter) {
      window.Graphics._updateAllElements();
    }
    window.dispatchEvent(new Event('resize'));
  }, 100);
});

window.addEventListener('resize', () => {
  if (window.Graphics && typeof window.Graphics._updateAllElements === 'function' && window.Graphics._canvas && window.Graphics._errorPrinter) {
    window.Graphics._updateAllElements();
  }
});

// 8. Noto Sans CJK KR 자동 폴백 폰트 시스템
function setupFallbackFont() {
  const possiblePaths = [
    // 1순위: 게임 디렉토리 번들 폰트
    path.join(gameDir, 'fonts', 'NotoSansCJKkr-Regular.otf'),
    path.join(gameDir, 'fonts', 'NotoSansKR-Regular.otf'),
    path.join(gameDir, 'fonts', 'NotoSansKR-Regular.ttf'),
    path.join(gameDir, 'fonts', 'LINESeedKR-Rg.ttf'),
    path.join(gameRootDir, 'fonts', 'NotoSansCJKkr-Regular.otf'),
    path.join(gameRootDir, 'fonts', 'NotoSansKR-Regular.otf'),
    path.join(gameRootDir, 'fonts', 'NotoSansKR-Regular.ttf'),

    // 2순위: 런타임 공유 번들 폰트
    path.join(runtimeDir, 'fonts', 'NotoSansCJKkr-Regular.otf'),
    path.join(runtimeDir, 'fonts', 'NotoSansKR-Regular.otf'),
    path.join(runtimeDir, 'fonts', 'NotoSansKR-Regular.ttf'),

    // 3순위: 런처 스크립트가 전달한 포트마스터 동적 홈 경로 ($controlfolder)
    process.env.PORTMASTER_HOME ? path.join(process.env.PORTMASTER_HOME, 'resources', 'NotoSansKR-Regular.otf') : null,

    // 4순위: 기기 OS별 알려진 공유 경로
    '/userdata/roms/ports/PortMaster/resources/NotoSansKR-Regular.otf',
    '/roms/ports/PortMaster/resources/NotoSansKR-Regular.otf',
    '/opt/system/Tools/PortMaster/resources/NotoSansKR-Regular.otf',
    '/opt/tools/PortMaster/resources/NotoSansKR-Regular.otf',
    '/mnt/SDCARD/App/PortMaster/resources/NotoSansKR-Regular.otf',
    '/roms2/ports/PortMaster/resources/NotoSansKR-Regular.otf'
  ].filter(Boolean);

  const fontPath = possiblePaths.find(p => origExistsSync.call(fs, p));
  if (!fontPath) {
    console.log('[mkmv-preload] No fallback CJK font file found');
    return;
  }

  try {
    const fontBuf = origReadFileSync.call(fs, fontPath);
    const fontArrayBuffer = fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength);

    const fontFamilies = [
      'GameFont',
      'Noto Sans CJK KR',
      'NotoSansCJKkr',
      'Dotum',
      'AppleGothic',
      'SimHei',
      'Heiti TC',
      'Meiryo',
      'MS Gothic',
      'MS PGothic',
      'Yu Gothic',
      'YuGothic',
      'Hiragino Kaku Gothic ProN',
      'IPAGothic',
      'IPAMincho',
      'rmmz-mainfont',
      'rmmz-numberfont'
    ];

    fontFamilies.forEach(family => {
      try {
        const face = new FontFace(family, fontArrayBuffer);
        face.load().then(loadedFace => {
          document.fonts.add(loadedFace);
        }).catch(err => {
          console.warn(`[mkmv-preload] Failed to load FontFace ${family}:`, err);
        });
      } catch (err) {}
    });

    console.log(`[mkmv-preload] Successfully registered fallback font (${path.basename(fontPath)}) as ${fontFamilies.join(', ')}`);
  } catch (e) {
    console.warn('[mkmv-preload] Error reading fallback font file:', e);
  }

  const patchFontChain = () => {
    if (window.Window_Base && window.Window_Base.prototype) {
      const origStandardFontFace = window.Window_Base.prototype.standardFontFace;
      window.Window_Base.prototype.standardFontFace = function() {
        const base = origStandardFontFace ? origStandardFontFace.apply(this, arguments) : '';
        if (base && !base.includes('Noto Sans CJK KR')) {
          return base + ', "Noto Sans CJK KR", "Dotum", "AppleGothic", sans-serif';
        }
        return base;
      };
    }

    if (window.Bitmap && window.Bitmap.prototype) {
      const origMakeFontNameText = window.Bitmap.prototype._makeFontNameText;
      window.Bitmap.prototype._makeFontNameText = function() {
        const base = origMakeFontNameText ? origMakeFontNameText.apply(this, arguments) : '';
        if (base && !base.includes('Noto Sans CJK KR')) {
          return base + ', "Noto Sans CJK KR", "Dotum", "AppleGothic", sans-serif';
        }
        return base;
      };
    }
  };

  const fontTimer = setInterval(() => {
    if (window.Window_Base || window.Bitmap) {
      patchFontChain();
      clearInterval(fontTimer);
    }
  }, 30);
  setTimeout(() => clearInterval(fontTimer), 10000);
}
setupFallbackFont();

// 9. 부팅 폰트 검사 무한 대기 방지 가드
function patchFontReady() {
  if (window.Graphics) {
    window.Graphics.isFontLoaded = function() { return true; };
  }
  if (window.Scene_Boot && window.Scene_Boot.prototype) {
    window.Scene_Boot.prototype.isGameFontLoaded = function() { return true; };
  }
  if (window.FontManager) {
    window.FontManager.throwLoadError = function(family) {
      console.warn(`[mkmv-preload] Suppressed FontManager LoadError for ${family}`);
    };
  }
}

const fontReadyTimer = setInterval(() => {
  patchFontReady();
  if (window.Scene_Boot && window.Scene_Boot.prototype && window.Scene_Boot.prototype.isGameFontLoaded) {
    patchFontReady();
    clearInterval(fontReadyTimer);
  }
}, 20);
setTimeout(() => clearInterval(fontReadyTimer), 15000);

// 10. FPS 및 성능 오버레이 (showFps: true 시)
function setupFpsMeter() {
  if (!userOpt.showFps) return;

  let activated = false;

  const hookMvMeter = () => {
    if (window.Graphics) {
      if (window.Graphics._modifyExistingElements) {
        const origModify = window.Graphics._modifyExistingElements;
        window.Graphics._modifyExistingElements = function() {
          if (origModify) origModify.apply(this, arguments);
          if (window.Graphics._fpsMeter && window.Graphics._fpsMeter.container) {
            window.Graphics._fpsMeter.container.style.setProperty('z-index', '2147483640', 'important');
          }
          if (window.Graphics._modeBox) {
            window.Graphics._modeBox.style.setProperty('z-index', '2147483639', 'important');
          }
        };
      }

      if (window.Graphics._fpsMeter) {
        try {
          window.Graphics.showFps();
          if (typeof window.Graphics._fpsMeter.showFps === 'function') {
            window.Graphics._fpsMeter.showFps();
          }
          if (window.Graphics._fpsMeter.container) {
            window.Graphics._fpsMeter.container.style.setProperty('z-index', '2147483640', 'important');
            window.Graphics._fpsMeter.container.style.display = 'block';
          }
          if (window.Graphics._modeBox) {
            window.Graphics._modeBox.style.setProperty('z-index', '2147483639', 'important');
            window.Graphics._modeBox.style.opacity = '1';
          }
          activated = true;
        } catch (e) {}
      }
    }
  };

  const mvTimer = setInterval(hookMvMeter, 100);
  setTimeout(() => clearInterval(mvTimer), 25000);

  setTimeout(() => {
    if (!activated && (!window.Graphics || !window.Graphics._fpsMeter)) {
      createFallbackFpsOverlay();
    }
  }, 6000);
}

function createFallbackFpsOverlay() {
  if (document.getElementById('mkmv-fps-counter')) return;

  const overlay = document.createElement('div');
  overlay.id = 'mkmv-fps-counter';
  overlay.style.setProperty('position', 'fixed', 'important');
  overlay.style.setProperty('top', '10px', 'important');
  overlay.style.setProperty('left', '12px', 'important');
  overlay.style.setProperty('z-index', '2147483647', 'important');
  overlay.style.setProperty('background-color', 'rgba(0, 0, 0, 0.75)', 'important');
  overlay.style.setProperty('color', '#00ff66', 'important');
  overlay.style.setProperty('font-family', 'monospace, sans-serif', 'important');
  overlay.style.setProperty('font-size', '14px', 'important');
  overlay.style.setProperty('font-weight', 'bold', 'important');
  overlay.style.setProperty('padding', '3px 8px', 'important');
  overlay.style.setProperty('border-radius', '4px', 'important');
  overlay.style.setProperty('border', '1px solid rgba(0, 255, 102, 0.5)', 'important');
  overlay.style.setProperty('pointer-events', 'none', 'important');
  overlay.style.setProperty('user-select', 'none', 'important');
  overlay.style.setProperty('display', 'block', 'important');
  overlay.textContent = 'FPS: --';

  const attach = () => {
    if (document.body) {
      document.body.appendChild(overlay);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) document.body.appendChild(overlay);
      });
    }
  };
  attach();

  let frameCount = 0;
  let lastTime = performance.now();

  function updateFpsLoop(now) {
    frameCount++;
    const elapsed = now - lastTime;
    if (elapsed >= 500) {
      const currentFps = Math.round((frameCount * 1000) / elapsed);
      overlay.textContent = `FPS: ${currentFps}`;
      frameCount = 0;
      lastTime = now;

      if (overlay.style.zIndex !== '2147483647') {
        overlay.style.setProperty('z-index', '2147483647', 'important');
      }
      if (document.body && overlay.parentNode !== document.body) {
        document.body.appendChild(overlay);
      }
    }
    requestAnimationFrame(updateFpsLoop);
  }
  requestAnimationFrame(updateFpsLoop);
}

setupFpsMeter();

// 11. 슬립/화면 복귀 시 오디오 컨텍스트 자동 복구
function setupAudioRecovery() {
  function resumeAudioContext() {
    try {
      if (window.WebAudio && window.WebAudio._context && window.WebAudio._context.state === 'suspended') {
        window.WebAudio._context.resume().then(() => {
          console.log('[mkmv-preload] WebAudio context resumed after sleep/focus');
        }).catch((e) => {
          console.warn('[mkmv-preload] WebAudio resume failed:', e);
        });
      }
    } catch (e) {}
  }

  window.addEventListener('focus', resumeAudioContext);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      resumeAudioContext();
    }
  });
  window.addEventListener('keydown', resumeAudioContext, { capture: true, passive: true });
}
setupAudioRecovery();

// 12. 알만툴 WebAudio & Html5Audio 오디오 리소스 유니코드 직접 복구
function setupUniversalAudioRecovery() {
  const hookTimer = setInterval(() => {
    let webAudioHooked = false;
    let html5AudioHooked = false;

    if (window.WebAudio && window.WebAudio.prototype && window.WebAudio.prototype._load) {
      if (!window.WebAudio.prototype._mkmvAudioHooked) {
        window.WebAudio.prototype._mkmvAudioHooked = true;
        const origWebAudioLoad = window.WebAudio.prototype._load;

        window.WebAudio.prototype._load = function(url) {
          if (!url || typeof url !== 'string' || url.startsWith('data:') || url.startsWith('blob:')) {
            return origWebAudioLoad.apply(this, arguments);
          }

          const isEncryptedAudio = window.Decrypter && window.Decrypter.hasEncryptedAudio;
          const resolved = resolveGamePath(url);
          const exists = resolved && origExistsSync.call(fs, resolved);
          const isEncryptedExt = resolved && (resolved.endsWith('.rpgmvo') || resolved.endsWith('.rpgmvm') || resolved.endsWith('.ogg_') || resolved.endsWith('.m4a_'));
          const hasSpecial = /[^\x00-\x7F]/.test(url || '') || (resolved && /[^\x00-\x7F]/.test(resolved)) || (url && url.includes('%'));

          if (!isEncryptedAudio && !isEncryptedExt && hasSpecial && exists && window.WebAudio._context) {
            try {
              const buf = origReadFileSync.call(fs, resolved);
              const isRpgmvHeader = buf.length >= 16 && buf[0] === 0x52 && buf[1] === 0x50 && buf[2] === 0x47 && buf[3] === 0x4D && buf[4] === 0x56;
              if (!isRpgmvHeader) {
                console.log(`[mkmv-preload] Direct loading Unicode WebAudio via Node.js fs: ${url}`);
                const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                this._onXhrLoad({ status: 200, response: arrayBuffer });
                return;
              }
            } catch (e) {
              console.error('[mkmv-preload] Direct WebAudio load error:', e);
            }
          }
          return origWebAudioLoad.apply(this, arguments);
        };
        webAudioHooked = true;
      }
    }

    if (window.Html5Audio && typeof window.Html5Audio._load === 'function') {
      if (!window.Html5Audio._mkmvAudioHooked) {
        window.Html5Audio._mkmvAudioHooked = true;
        const origHtml5Load = window.Html5Audio._load;

        window.Html5Audio._load = function(url) {
          if (!url || typeof url !== 'string' || url.startsWith('data:') || url.startsWith('blob:')) {
            return origHtml5Load.apply(this, arguments);
          }

          const isEncryptedAudio = window.Decrypter && window.Decrypter.hasEncryptedAudio;
          const resolved = resolveGamePath(url);
          const exists = resolved && origExistsSync.call(fs, resolved);
          const isEncryptedExt = resolved && (resolved.endsWith('.rpgmvo') || resolved.endsWith('.rpgmvm') || resolved.endsWith('.ogg_') || resolved.endsWith('.m4a_'));
          const hasSpecial = /[^\x00-\x7F]/.test(url || '') || (resolved && /[^\x00-\x7F]/.test(resolved)) || (url && url.includes('%'));

          if (!isEncryptedAudio && !isEncryptedExt && hasSpecial && exists && this._audioElement) {
            try {
              const buf = origReadFileSync.call(fs, resolved);
              const isRpgmvHeader = buf.length >= 16 && buf[0] === 0x52 && buf[1] === 0x50 && buf[2] === 0x47 && buf[3] === 0x4D && buf[4] === 0x56;
              if (!isRpgmvHeader) {
                console.log(`[mkmv-preload] Direct loading Unicode Html5Audio via Blob: ${url}`);
                const ext = path.extname(resolved).toLowerCase();
                const mime = ext === '.ogg' ? 'audio/ogg' : (ext === '.m4a' ? 'audio/mp4' : 'audio/mpeg');
                const blob = new Blob([buf], { type: mime });
                this._isLoading = true;
                this._audioElement.src = URL.createObjectURL(blob);
                this._audioElement.load();
                return;
              }
            } catch (e) {
              console.error('[mkmv-preload] Direct Html5Audio load error:', e);
            }
          }
          return origHtml5Load.apply(this, arguments);
        };
        html5AudioHooked = true;
      }
    }

    if (webAudioHooked || (window.WebAudio && window.WebAudio.prototype && window.WebAudio.prototype._mkmvAudioHooked)) {
      clearInterval(hookTimer);
      console.log('[mkmv-preload] Universal Audio recovery hooks installed successfully');
    }
  }, 50);
  setTimeout(() => clearInterval(hookTimer), 30000);
}
setupUniversalAudioRecovery();

// 13. 알만툴 DataManager JSON 데이터 파일 유니코드 복구
function setupDataManagerRecovery() {
  const hookTimer = setInterval(() => {
    if (window.DataManager && typeof window.DataManager.loadDataFile === 'function') {
      if (!window.DataManager._mkmvDataHooked) {
        window.DataManager._mkmvDataHooked = true;
        const origLoadDataFile = window.DataManager.loadDataFile;
        window.DataManager.loadDataFile = function(name, src) {
          const dataUrl = 'data/' + src;
          const resolved = resolveGamePath(dataUrl);
          const exists = resolved && origExistsSync.call(fs, resolved);
          const hasSpecial = /[^\x00-\x7F]/.test(src || '') || (resolved && /[^\x00-\x7F]/.test(resolved));

          if (hasSpecial && exists) {
            try {
              console.log(`[mkmv-preload] Direct loading Unicode DataFile via Node.js fs: ${src}`);
              const content = origReadFileSync.call(fs, resolved, 'utf8');
              window[name] = JSON.parse(content.replace(/^\uFEFF/, ''));
              DataManager.onLoad(window[name]);
              return;
            } catch (e) {
              console.error('[mkmv-preload] Direct DataFile load error:', e);
            }
          }
          return origLoadDataFile.apply(this, arguments);
        };
        clearInterval(hookTimer);
        console.log('[mkmv-preload] DataManager unicode recovery hook installed successfully');
      }
    }
  }, 50);
  setTimeout(() => clearInterval(hookTimer), 30000);
}
setupDataManagerRecovery();

// 14. 저사양 1GB 기기용 메모리 안정화 및 가비지 컬렉션(GC) 관리
function setupLowMemoryManager() {
  if (userOpt.lowMemoryMode === false) return;

  // 씬 전환(메뉴 진입/퇴출 등) 시 가비지 컬렉션 실행
  const patchSceneCleanup = () => {
    if (window.Scene_Base && window.Scene_Base.prototype) {
      const origTerminate = window.Scene_Base.prototype.terminate;
      window.Scene_Base.prototype.terminate = function() {
        origTerminate.apply(this, arguments);
        if (window.gc) {
          setTimeout(() => {
            try { if (window.gc) window.gc(); } catch (e) {}
          }, 100);
        }
      };
      return true;
    }
    return false;
  };

  // 맵 이동 및 로딩 완료 시 이전 맵 메모리 즉시 수거
  const patchMapCleanup = () => {
    if (window.Scene_Map && window.Scene_Map.prototype) {
      const origOnMapLoaded = window.Scene_Map.prototype.onMapLoaded;
      window.Scene_Map.prototype.onMapLoaded = function() {
        origOnMapLoaded.apply(this, arguments);
        if (window.gc) {
          setTimeout(() => {
            try { if (window.gc) window.gc(); } catch (e) {}
          }, 150);
        }
      };
      return true;
    }
    return false;
  };

  let sceneHooked = false;
  let mapHooked = false;
  const memTimer = setInterval(() => {
    if (!sceneHooked) sceneHooked = patchSceneCleanup();
    if (!mapHooked) mapHooked = patchMapCleanup();
    if (sceneHooked && mapHooked) {
      clearInterval(memTimer);
      console.log('[mkmv-preload] Low memory scene & map GC installed successfully');
    }
  }, 50);
  setTimeout(() => clearInterval(memTimer), 20000);

  // 배속 플레이 시 메모리 누적 방지: 유휴 GC 및 메모리 로깅
  const gcIntervalMs = (userOpt.gcIntervalSeconds !== undefined ? userOpt.gcIntervalSeconds : 30) * 1000;
  if (gcIntervalMs === 0) return;
  let logCounter = 0;
  setInterval(() => {
    try {
      if (window.gc) window.gc();

      logCounter++;
      if (logCounter % 2 === 0 && process && process.memoryUsage) {
        const mem = process.memoryUsage();
        const rssMB = Math.round(mem.rss / 1024 / 1024);
        const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
        console.log(`[mkmv-mem] RSS: ${rssMB}MB | Heap: ${heapUsedMB}/${heapTotalMB}MB`);
      }
    } catch (e) {}
  }, gcIntervalMs);
}
setupLowMemoryManager();
