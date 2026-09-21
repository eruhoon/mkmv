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

  // 3. 만약 확장자가 다른 동일 이름의 미디어 파일이 존재하는 경우 (.ogg <-> .m4a, .png <-> .rpgmvp / .png_)
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
  if (origExistsSync.call(fs, targetPath)) return targetPath;
  const normalizedTarget = path.resolve(targetPath);

  // 1. 단일 파일 레벨 빠른 대소문자/유니코드 매칭 (부모 폴더가 존재하는 경우 즉시 복구)
  const parentDir = path.dirname(normalizedTarget);
  if (origExistsSync.call(fs, parentDir)) {
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

// 게임 내 URL (상대 경로, 퍼센트 인코딩, file:// 프로토콜 등)을 절대 디스크 경로로 안전 정규화
function resolveGamePath(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') return null;
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

      // 디스크에 실재하는 파일에 대해 Chromium C++ 로더가 유니코드/특수문자 파싱 실패(net::ERR_FILE_NOT_FOUND) 시 즉시 주입
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
    // 번역/다국어 패치 게임에서 누락된 lng.txt 파일 자동 복구 ('ko' 기본값 생성 및 반환)
    if (typeof p === 'string' && (p === 'lng.txt' || p.endsWith('/lng.txt') || p.endsWith('\\lng.txt'))) {
      console.warn(`[mkmv-preload] Missing ${p} detected, automatically generating fallback language 'ko'`);
      try {
        origWriteFileSync.call(fs, resolved, 'ko', 'utf8');
      } catch (e) {}
      return 'ko';
    }
    throw err;
  }
  // lng.txt 파일의 UTF-8 BOM(\uFEFF) 및 개행 문자 정제 (경로 접두사 오염 방지)
  if (typeof p === 'string' && (p === 'lng.txt' || p.endsWith('/lng.txt') || p.endsWith('\\lng.txt'))) {
    if (typeof content === 'string') {
      content = content.replace(/^\uFEFF/, '').trim();
    } else if (Buffer.isBuffer(content)) {
      const str = content.toString('utf8').replace(/^\uFEFF/, '').trim();
      content = options ? str : Buffer.from(str, 'utf8');
    }
  }
  // 세이브 파일이 0바이트로 손상되었을 경우 직전 정상 백업(.bak) 자동 복구 (MV .rpgsave 및 MZ .rmmzsave 지원)
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
      // 1. 기존 정상 세이브를 .bak 숨김 서브폴더에 보존
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

      // 2. 임시 파일에 기록 후 물리 디스크(SD 카드) 강제 플러시 (fsync)
      const tmpPath = resolvedPath + '.tmp.' + Date.now();
      const fd = origOpenSync.call(fs, tmpPath, 'w');
      try {
        origWriteSync.call(fs, fd, data);
        try { origFsyncSync.call(fs, fd); } catch (e) {}
      } finally {
        try { origCloseSync.call(fs, fd); } catch (e) {}
      }

      // 3. 원자적(Atomic) 교체로 쓰기 도중 전원 차단 시에도 기존 세이브 보존
      origRenameSync.call(fs, tmpPath, resolvedPath);
      return;
    } catch (err) {
      console.warn('[mkmv-preload] Atomic save failed, falling back to direct write:', err);
    }
  }
  return origWriteFileSync.call(fs, resolvedPath, data, options);
};

// 사용자 정의 옵션 (config.json / mkmv.json) 로드
let userOpt = { width: 1920, height: 1080, pixelated: true, scaling: 'fit', hideCursor: false, disableTouch: false, showFps: false, debugKeymap: false, fastForward: true, fastForwardSpeed: 2, lowMemoryMode: true, imageCacheLimit: 3 };
try {
  const runtimeMkmv = path.join(runtimeDir, 'mkmv.json');
  const runtimeConfig = path.join(runtimeDir, 'config.json');
  if (origExistsSync.call(fs, runtimeMkmv)) {
    userOpt = Object.assign(userOpt, JSON.parse(origReadFileSync.call(fs, runtimeMkmv, 'utf8')));
  } else if (origExistsSync.call(fs, runtimeConfig)) {
    userOpt = Object.assign(userOpt, JSON.parse(origReadFileSync.call(fs, runtimeConfig, 'utf8')));
  }
  const gameMkmvJson = path.join(gameRootDir, 'mkmv.json');
  const gameConfigJson = path.join(gameRootDir, 'config.json');
  if (origExistsSync.call(fs, gameMkmvJson)) {
    userOpt = Object.assign(userOpt, JSON.parse(origReadFileSync.call(fs, gameMkmvJson, 'utf8')));
  } else if (gameRootDir !== runtimeDir && origExistsSync.call(fs, gameConfigJson)) {
    userOpt = Object.assign(userOpt, JSON.parse(origReadFileSync.call(fs, gameConfigJson, 'utf8')));
  }
} catch (e) {}

if (!process.mainModule) {
  process.mainModule = { filename: path.join(gameDir, 'index.html') };
} else {
  process.mainModule.filename = path.join(gameDir, 'index.html');
}

// 캔버스 2D 픽셀 데이터 빈번한 읽기(getImageData) 시 CPU 성능 최적화 및 경고 방지
try {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, attributes) {
    if (type === '2d') {
      attributes = Object.assign({}, attributes, { willReadFrequently: true });
    }
    return origGetContext.call(this, type, attributes);
  };
} catch (e) {}

// 2. NW.js 호환성 객체 (알만툴 MV & MZ 필수 모듈 Shim)
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

// Steamworks (greenworks) Shim 객체 (ARM64 리눅스 바이너리 부재로 인한 플러그인 크래시 방지)
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

// 브라우저 창 크기 및 위치 강제 변경 방지 (Yanfly CoreEngine, 인게임 스크립트의 화면 축소 및 쏠림 원천 차단)
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

// 플러그인 해상도 강제 재설정 방지 (Yanfly CoreEngine updateResolution 등 무력화)
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

// NW.js 환경 식별 버전 주입 (Yanfly Core 등 플러그인의 데스크톱 분기 판별 지원)
if (!process.versions['node-webkit']) {
  process.versions['node-webkit'] = '0.13.0';
}
if (!process.versions['nw']) {
  process.versions['nw'] = '0.13.0';
}
if (!process.versions['nw-flavor']) {
  process.versions['nw-flavor'] = 'normal';
}

// 3. 알만툴 내장 게임패드 폴링 비활성화 (포트마스터 gptokeyb 단독 위임 및 키 충돌/이중 입력 방지)
function disableInternalGamepad() {
  if (window.Input) {
    window.Input._pollGamepads = function() {};
    console.log('[mkmv-preload] RPG Maker MV internal gamepad polling disabled (delegated to gptokeyb)');
  }
}

const inputPollTimer = setInterval(() => {
  if (window.Input) {
    disableInternalGamepad();
    clearInterval(inputPollTimer);
  }
}, 30);
setTimeout(() => clearInterval(inputPollTimer), 10000);

// 4. 알만툴 오디오 포커스 아웃 음소거 방지 (창 포커스 튐으로 인한 BGM 일시정지 방지)
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

// 5. 전체화면 토글(F4) 및 새로고침(F5, Ctrl+R) 단축키 가드
window.addEventListener('keydown', (e) => {
  const key = e.key ? e.key.toUpperCase() : '';
  if (key === 'F4' || key === 'F5' || (e.ctrlKey && key === 'R')) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

// 6. 터치 동작 비활성화 옵션 (disableTouch: true 설정 시)
if (userOpt.disableTouch) {
  const cancelTouch = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('touchstart', cancelTouch, { capture: true, passive: false });
  window.addEventListener('touchmove', cancelTouch, { capture: true, passive: false });
  window.addEventListener('touchend', cancelTouch, { capture: true, passive: false });
  window.addEventListener('touchcancel', cancelTouch, { capture: true, passive: false });

  const touchTimer = setInterval(() => {
    if (window.TouchInput) {
      window.TouchInput._setupEventHandlers = function() {};
      clearInterval(touchTimer);
    }
  }, 30);
  setTimeout(() => clearInterval(touchTimer), 10000);
  console.log('[mkmv-preload] Touch input disabled via config.json');
}

// 7. 고해상도(1080p/720p) 스케일링 및 픽셀 선명도 보정 CSS 주입
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

// 알만툴 Graphics 엔진 실시간 스케일링 패치 (터치/마우스 좌표 및 전체화면 정밀 일치)
function patchGraphics() {
  if (!window.Graphics) return;

  window.Graphics._defaultStretchMode = function() { return true; };
  window.Graphics._stretchEnabled = true;

  // 'fill' 또는 'stretch'는 잘림 없이 화면 가로/세로 전체를 꽉 채우는 스트레치 모드로 동작
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
      // 화면 잘림(Crop) 없이 가로/세로를 디스플레이 전체로 꽉 채움
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

// Graphics 객체 생성 즉시 및 로드 시점에 패치 적용
const gTimer = setInterval(() => {
  if (window.Graphics) {
    patchGraphics();
    clearInterval(gTimer);
  }
}, 30);
setTimeout(() => clearInterval(gTimer), 10000);

// SceneManager 시작 시점 및 씬 전환 시 해상도/스케일 강제 유지
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

// 6. Noto Sans CJK KR 자동 폴백 폰트 시스템
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

    // 2순위: 런처 스크립트가 전달한 포트마스터 동적 홈 경로 ($controlfolder)
    process.env.PORTMASTER_HOME ? path.join(process.env.PORTMASTER_HOME, 'resources', 'NotoSansKR-Regular.otf') : null,

    // 3순위: 기기 OS별(Knulli/Batocera, ROCKNIX, ArkOS, AmberELEC, muOS) 알려진 공유 경로
    '/userdata/roms/ports/PortMaster/resources/NotoSansKR-Regular.otf', // Knulli / Batocera
    '/roms/ports/PortMaster/resources/NotoSansKR-Regular.otf',          // ROCKNIX
    '/opt/system/Tools/PortMaster/resources/NotoSansKR-Regular.otf',    // ArkOS
    '/opt/tools/PortMaster/resources/NotoSansKR-Regular.otf',           // AmberELEC
    '/mnt/SDCARD/App/PortMaster/resources/NotoSansKR-Regular.otf',      // muOS
    '/roms2/ports/PortMaster/resources/NotoSansKR-Regular.otf'          // 2nd SD Card
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
      // 일본어 알만툴 MV 게임 표준 폰트 호환성 추가
      'Meiryo',
      'MS Gothic',
      'MS PGothic',
      'Yu Gothic',
      'YuGothic',
      'Hiragino Kaku Gothic ProN',
      'IPAGothic',
      'IPAMincho',
      // RPG Maker MZ 전용 표준 폰트 호환성 추가
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

  // RPG Maker MV & MZ 폰트 체인 패치 (누락된 한글/일본어/한자 글리프 자동 폴백)
  const fontChain = 'rmmz-mainfont, GameFont, "Noto Sans CJK KR", "NotoSansCJKkr", "Meiryo", "MS Gothic", "Yu Gothic", "Dotum", "AppleGothic", "SimHei", sans-serif';

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

// 7. RPG Maker MV & MZ 부팅 폰트 검사 무한 대기(Freezing / Black Screen) 방지 가드
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

// 8. FPS 및 실시간 성능 오버레이 (config.json의 showFps: true 설정 시)
function setupFpsMeter() {
  if (!userOpt.showFps) return;

  let activated = false;

  // 알만툴 MV 엔진 내장 FPSMeter 및 ModeBox(Canvas/WebGL) 좌상단 활성화
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

  // 알만툴 내장 FPSMeter가 없는 비표준 게임의 경우에만 좌상단 폴백 오버레이 생성
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

// 8. PortMaster gptokeyb 게임패드 충돌 방지 및 Web Gamepad API 격리
// (gptokeyb가 키보드 입력을 전송할 때 브라우저의 Gamepad API가 이중 입력 및 버튼 충돌(ok vs cancel)을 일으켜 키가 씹히는 현상 원천 차단)
let origNativeGetGamepads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : null;

function setupNativeGamepadConflictResolver() {
  if (userOpt.disableNativeGamepad === false) {
    console.log('[mkmv-preload] Native Gamepad API active (disableNativeGamepad: false)');
    return;
  }

  // 1. Web Gamepad API 격리 (게임 엔진 및 외부 플러그인에 빈 게임패드 목록 반환)
  try {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      enumerable: true,
      value: function() {
        return [];
      }
    });
  } catch (e) {
    try { navigator.getGamepads = () => []; } catch (err) {}
  }

  // 2. 알만툴 MV / MZ 내장 Input 게임패드 폴러 무력화
  function patchInputGamepad(inputObj) {
    if (!inputObj || inputObj._mkmvGamepadNeutralized) return;
    inputObj._mkmvGamepadNeutralized = true;

    inputObj._pollGamepads = function() {
      // gptokeyb와의 이중 입력 및 _latestButton 덮어쓰기 방지 (no-op)
    };
    if (typeof inputObj._updateGamepadState === 'function') {
      inputObj._updateGamepadState = function() {};
    }
    console.log('[mkmv-preload] Neutralized Input._pollGamepads for gptokeyb harmony');
  }

  let inputHooked = false;
  const inputTimer = setInterval(() => {
    if (window.Input) {
      patchInputGamepad(window.Input);
      inputHooked = true;
      clearInterval(inputTimer);
    }
  }, 10);
  setTimeout(() => clearInterval(inputTimer), 30000);

  console.log('[mkmv-preload] Native Gamepad API isolated successfully (gptokeyb single-source mode)');
}

setupNativeGamepadConflictResolver();

// 8-2. 키매핑 디버그 오버레이 시스템 (debugKeymap: true 또는 F10 단축키 토글)
function setupKeymapDebugOverlay() {
  let isVisible = !!userOpt.debugKeymap;
  let overlay = null;

  const defaultKeyMapper = {
    9: 'tab',
    13: 'ok',
    16: 'shift',
    17: 'control',
    18: 'control',
    27: 'escape',
    32: 'ok',
    33: 'pageup',
    34: 'pagedown',
    37: 'left',
    38: 'up',
    39: 'right',
    40: 'down',
    45: 'escape',
    81: 'pageup',
    87: 'pagedown',
    88: 'escape',
    90: 'ok',
    96: 'escape',
    98: 'down',
    100: 'left',
    102: 'right',
    104: 'up',
    120: 'debug'
  };

  function getRpgAction(keyCode) {
    if (window.Input && window.Input.keyMapper && window.Input.keyMapper[keyCode]) {
      return window.Input.keyMapper[keyCode];
    }
    return defaultKeyMapper[keyCode] || null;
  }

  const activeKeys = new Map();
  const history = [];
  const MAX_HISTORY = 6;

  function render() {
    if (!overlay || !isVisible) return;

    let html = '<div style="font-weight:bold; color:#00e5ff; font-size:13px; margin-bottom:4px; border-bottom:1px solid rgba(0,229,255,0.4); padding-bottom:3px; display:flex; justify-content:space-between;">' +
               '<span>🎮 KEYMAP DEBUG</span><span style="color:#aaa; font-size:10px; margin-left:10px;">[F10 Toggle]</span></div>';

    // 현재 누르고 있는 키 상태
    const activeArr = Array.from(activeKeys.values());
    if (activeArr.length > 0) {
      const badges = activeArr.map(item => {
        const act = item.action ? `:${item.action}` : '';
        return `<span style="background:#00e5ff; color:#05101a; padding:1px 5px; border-radius:3px; font-weight:bold; margin-right:3px; font-size:11px;">${item.display}${act}</span>`;
      }).join(' ');
      html += `<div style="margin-bottom:5px; font-size:11px;"><span style="color:#aaa;">HOLDING:</span> ${badges}</div>`;
    } else {
      html += '<div style="margin-bottom:5px; font-size:11px; color:#888;">HOLDING: <span style="color:#666;">(none)</span></div>';
    }

    // 최근 키 입력 로그 (최신순)
    html += '<div style="font-size:11px; display:flex; flex-direction:column; gap:2px;">';
    if (history.length === 0) {
      html += '<div style="color:#777; font-style:italic;">Waiting for gamepad button / key...</div>';
    } else {
      for (const item of history) {
        const isDown = item.type === 'DOWN';
        const typeColor = isDown ? '#00ff66' : '#ffaa00';
        const actionStr = item.action 
          ? `<span style="color:#00e5ff; font-weight:bold;">➡ "${item.action}"</span>` 
          : '<span style="color:#777;">➡ (none)</span>';
        html += `<div><span style="color:${typeColor}; font-weight:bold;">[${item.type}]</span> <span style="color:#ffffff; font-weight:bold;">${item.key}</span> <span style="color:#888;">(code: ${item.code}, which: ${item.keyCode})</span> ${actionStr}</div>`;
      }
    }
    html += '</div>';

    overlay.innerHTML = html;
  }

  function ensureOverlay() {
    if (!document.body) return null;

    let isNew = false;
    if (!overlay) {
      overlay = document.getElementById('mkmv-keymap-debug');
    }
    if (!overlay) {
      isNew = true;
      overlay = document.createElement('div');
      overlay.id = 'mkmv-keymap-debug';
      overlay.style.setProperty('position', 'absolute', 'important');
      overlay.style.setProperty('top', userOpt.showFps ? '45px' : '15px', 'important');
      overlay.style.setProperty('left', '15px', 'important');
      overlay.style.setProperty('z-index', '2147483647', 'important');
      overlay.style.setProperty('background-color', '#0b132b', 'important');
      overlay.style.setProperty('color', '#ffffff', 'important');
      overlay.style.setProperty('font-family', 'monospace, "Courier New", sans-serif', 'important');
      overlay.style.setProperty('font-size', '13px', 'important');
      overlay.style.setProperty('line-height', '1.4', 'important');
      overlay.style.setProperty('padding', '8px 14px', 'important');
      overlay.style.setProperty('border-radius', '6px', 'important');
      overlay.style.setProperty('border', '3px solid #00ffff', 'important');
      overlay.style.setProperty('box-shadow', '0 0 20px rgba(0, 255, 255, 0.8)', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
      overlay.style.setProperty('user-select', 'none', 'important');
      overlay.style.setProperty('min-width', '280px', 'important');
      overlay.style.setProperty('max-width', '450px', 'important');
      overlay.style.setProperty('visibility', 'visible', 'important');
      overlay.style.setProperty('opacity', '1', 'important');
      overlay.style.setProperty('transform', 'translateZ(9999px)', 'important');
      overlay.style.setProperty('will-change', 'transform', 'important');
    }

    overlay.style.setProperty('display', isVisible ? 'block' : 'none', 'important');
    if (overlay.parentNode !== document.body || document.body.lastElementChild !== overlay) {
      document.body.appendChild(overlay);
      if (isNew) {
        console.log('[mkmv-overlay] Keymap debug overlay successfully attached to document.body (z-index: 2147483647)');
      }
    }
    render();
    return overlay;
  }

  // 초기 및 DOM 완료 시 document.body에 최우선 부착
  ensureOverlay();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ensureOverlay());
  }

  // 알만툴 엔진 캔버스 생성/장면 전환 시 캔버스 뒤로 밀리지 않도록 최상단(lastChild) 유지
  const attachInterval = setInterval(() => {
    ensureOverlay();
  }, 150);

  function recordKey(type, e) {
    const key = e.key || e.code || 'Unknown';
    const code = e.code || '-';
    const keyCode = e.keyCode || e.which || 0;
    const action = getRpgAction(keyCode);

    console.log(`[mkmv-input] ${type}: key="${key}", code="${code}", keyCode=${keyCode} -> RPG: "${action || 'none'}"`);

    const keyId = `${code}_${keyCode}`;
    if (type === 'DOWN') {
      activeKeys.set(keyId, { display: key, code, keyCode, action });
    } else {
      activeKeys.delete(keyId);
    }

    history.unshift({
      type,
      key,
      code,
      keyCode,
      action,
      time: Date.now()
    });
    if (history.length > MAX_HISTORY) {
      history.pop();
    }

    ensureOverlay();
  }

  // 물리 패드 하드웨어 상태 감시 (진단용 - origNativeGetGamepads 사용)
  let lastPadState = '';
  setInterval(() => {
    if (!isVisible || !origNativeGetGamepads) return;
    try {
      const pads = origNativeGetGamepads();
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (!pad) continue;
        const pressed = [];
        for (let b = 0; b < pad.buttons.length; b++) {
          if (pad.buttons[b].pressed || pad.buttons[b].value > 0.5) {
            pressed.push(b);
          }
        }
        if (pressed.length > 0) {
          const stateStr = `pad${i}_btn[${pressed.join(',')}]`;
          if (stateStr !== lastPadState) {
            lastPadState = stateStr;
            console.log(`[mkmv-gamepad] Hardware Gamepad #${i} (${pad.id}): Pressed buttons: ${pressed.join(', ')}`);
          }
        }
      }
    } catch (e) {}
  }, 100);

  const handleKeydown = (e) => {
    if (e._mkmvHandled) return;
    e._mkmvHandled = true;
    const key = e.key ? e.key.toUpperCase() : '';
    if (key === 'F10' || e.code === 'F10' || e.keyCode === 121) {
      isVisible = !isVisible;
      const el = ensureOverlay();
      if (el) {
        el.style.setProperty('display', isVisible ? 'block' : 'none', 'important');
        if (isVisible) render();
      }
      console.log(`[mkmv-preload] Keymap debug overlay visibility toggled: ${isVisible}`);
      e.preventDefault();
      return;
    }
    recordKey('DOWN', e);
  };

  const handleKeyup = (e) => {
    if (e._mkmvHandled) return;
    e._mkmvHandled = true;
    const key = e.key ? e.key.toUpperCase() : '';
    if (key === 'F10' || e.code === 'F10' || e.keyCode === 121) {
      e.preventDefault();
      return;
    }
    recordKey('UP', e);
  };

  // 최상위 window에만 캡처 리스너 1회 등록 (이벤트 전파 중복 방지)
  window.addEventListener('keydown', handleKeydown, { capture: true, passive: false });
  window.addEventListener('keyup', handleKeyup, { capture: true, passive: false });

  if (isVisible) {
    console.log('[mkmv-preload] Keymap debug overlay enabled via config (debugKeymap: true)');
    ensureOverlay();
  }
}

setupKeymapDebugOverlay();

// 9. 고속 배속(Fast-Forward / 터보) 시스템 (R3 버튼 또는 R/Tab 키로 토글)
function setupFastForward() {
  if (userOpt.fastForward === false) return;

  const speedMultiplier = Math.max(1, Number(userOpt.fastForwardSpeed) || 2);
  let isFastForward = false;
  let indicator = null;

  function ensureIndicator() {
    if (!indicator) {
      indicator = document.getElementById('mkmv-fast-forward');
    }
    if (!indicator) {
      if (!document.body) return null;
      indicator = document.createElement('div');
      indicator.id = 'mkmv-fast-forward';
      indicator.style.setProperty('display', 'none', 'important');
      indicator.style.setProperty('position', 'fixed', 'important');
      indicator.style.setProperty('top', '10px', 'important');
      indicator.style.setProperty('right', '12px', 'important');
      indicator.style.setProperty('z-index', '2147483647', 'important');
      indicator.style.setProperty('background-color', 'rgba(0, 0, 0, 0.75)', 'important');
      indicator.style.setProperty('color', '#00e5ff', 'important');
      indicator.style.setProperty('font-family', 'monospace, sans-serif', 'important');
      indicator.style.setProperty('font-size', '14px', 'important');
      indicator.style.setProperty('font-weight', 'bold', 'important');
      indicator.style.setProperty('padding', '3px 8px', 'important');
      indicator.style.setProperty('border-radius', '4px', 'important');
      indicator.style.setProperty('border', '1px solid rgba(0, 229, 255, 0.6)', 'important');
      indicator.style.setProperty('box-shadow', '0 0 8px rgba(0, 229, 255, 0.4)', 'important');
      indicator.style.setProperty('pointer-events', 'none', 'important');
      indicator.style.setProperty('user-select', 'none', 'important');
      indicator.textContent = `▶▶ ${speedMultiplier}x`;
      document.body.appendChild(indicator);
    }
    return indicator;
  }

  // DOM 로드 완료 시 인디케이터 안전 준비
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ensureIndicator());
  } else {
    ensureIndicator();
  }

  function toggleFastForward() {
    isFastForward = !isFastForward;
    const badge = ensureIndicator();
    if (badge) {
      badge.style.setProperty('display', isFastForward ? 'block' : 'none', 'important');
      if (isFastForward) {
        if (badge.style.zIndex !== '2147483647') {
          badge.style.setProperty('z-index', '2147483647', 'important');
        }
        if (document.body && badge.parentNode !== document.body) {
          document.body.appendChild(badge);
        }
      }
    }
    console.log(`[mkmv-preload] Fast forward toggled: ${isFastForward ? `${speedMultiplier}x` : '1x'}`);
  }

  // R3 (키보드 R 또는 Tab) 키 토글 바인딩
  window.addEventListener('keydown', (e) => {
    const key = e.key ? e.key.toUpperCase() : '';
    const isR = key === 'R' || e.code === 'KeyR' || e.keyCode === 82;
    const isTab = key === 'TAB' || e.code === 'Tab' || e.keyCode === 9;
    if ((isR || isTab) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      toggleFastForward();
    }
  }, true);

  let renderSkipCounter = 0;

  // SceneManager.updateMain 훅 (로직 갱신 배속 + 프레임 스킵으로 CPU 과열 방지)
  const hookTimer = setInterval(() => {
    if (window.SceneManager && window.SceneManager.updateMain) {
      const origUpdateMain = window.SceneManager.updateMain;
      window.SceneManager.updateMain = function() {
        if (!isFastForward) {
          return origUpdateMain.apply(this, arguments);
        }

        // Fast-forward 가속 연산 (MZ 및 MV 통합 지원)
        if (isMZ || typeof this._deltaTime === 'undefined') {
          for (let i = 0; i < speedMultiplier; i++) {
            if (typeof this.updateFrameCount === 'function') this.updateFrameCount();
            if (typeof this.updateInputData === 'function') this.updateInputData();
            if (typeof this.updateEffekseer === 'function') this.updateEffekseer();
            if (typeof this.changeScene === 'function') this.changeScene();
            if (typeof this.updateScene === 'function') this.updateScene();
          }
          return; // MZ는 Pixi Ticker가 렌더링을 직접 담당하므로 updateMain 종료
        } else if (typeof Utils !== 'undefined' && Utils.isMobileSafari && Utils.isMobileSafari()) {
          for (let i = 0; i < speedMultiplier; i++) {
            this.changeScene();
            this.updateScene();
          }
        } else {
          const newTime = this._getTimeInMsWithoutMobileSafari ? this._getTimeInMsWithoutMobileSafari() : performance.now();
          let fTime = (newTime - this._currentTime) / 1000;
          if (fTime > 0.15) fTime = 0.15; // 지연 누적 상한 완화로 스파이크 방지
          this._currentTime = newTime;
          this._accumulator += fTime * speedMultiplier;

          let loops = 0;
          const maxLoops = Math.min(speedMultiplier * 2, 4); // 최대 루프 상한 4회로 타이트하게 제한
          while (this._accumulator >= this._deltaTime && loops < maxLoops) {
            this.updateInputData();
            this.changeScene();
            this.updateScene();
            this._accumulator -= this._deltaTime;
            loops++;
          }
          if (this._accumulator > this._deltaTime) {
            this._accumulator = 0;
          }
        }

        // 알만툴 MV 전용: 배속 시 CPU 렌더링 부하/발열 절반 절감을 위한 프레임 스킵 (2프레임당 1회 렌더링)
        renderSkipCounter = (renderSkipCounter + 1) % 2;
        if (renderSkipCounter === 0 && typeof this.renderScene === 'function') {
          this.renderScene();
        }

        if (typeof this.requestUpdate === 'function') {
          this.requestUpdate();
        }
      };
      clearInterval(hookTimer);
      console.log(`[mkmv-preload] Fast forward engine hook installed (${speedMultiplier}x available on R3 with thermal frame-skip)`);
    }
  }, 50);
  setTimeout(() => clearInterval(hookTimer), 30000);
}

setupFastForward();

// 슬립/화면 복귀 시 오디오 컨텍스트 자동 복구 (PulseAudio / WebAudio Sleep-Wake Recovery)
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

// 10. 리소스(이미지/사운드 등) 로딩 실패 시 log.txt에 파일명 및 에러 상세 기록
function setupResourceErrorLogger() {
  const hookTimer = setInterval(() => {
    if (window.Graphics && typeof window.Graphics.printLoadingError === 'function') {
      if (!window.Graphics._mkmvHooked) {
        window.Graphics._mkmvHooked = true;
        const origPrintLoadingError = window.Graphics.printLoadingError;
        window.Graphics.printLoadingError = function(url) {
          console.error(`[mkmv-resource-error] Failed to load resource: ${url}`);
          try {
            console.error(`[mkmv-resource-error] Target path: ${path.join(gameDir, url)}`);
          } catch (e) {}
          return origPrintLoadingError.apply(this, arguments);
        };
        clearInterval(hookTimer);
        console.log('[mkmv-preload] Resource loading error logger installed successfully');
      }
    }
  }, 50);
  setTimeout(() => clearInterval(hookTimer), 30000);
}

setupResourceErrorLogger();

// 11. 알만툴 WebAudio & Html5Audio 오디오 리소스 유니코드 직접 복구
function setupUniversalAudioRecovery() {
  const hookTimer = setInterval(() => {
    let webAudioHooked = false;
    let html5AudioHooked = false;

    if (window.WebAudio && window.WebAudio.prototype && window.WebAudio.prototype._load) {
      if (!window.WebAudio.prototype._mkmvAudioHooked) {
        window.WebAudio.prototype._mkmvAudioHooked = true;
        const origWebAudioLoad = window.WebAudio.prototype._load;

        window.WebAudio.prototype._load = function(url) {
          const resolved = resolveGamePath(url);
          const exists = resolved && origExistsSync.call(fs, resolved);
          const hasSpecial = /[^\x00-\x7F]/.test(url || '') || (resolved && /[^\x00-\x7F]/.test(resolved)) || (url && url.includes('%'));

          if (hasSpecial && exists && window.WebAudio._context) {
            try {
              console.log(`[mkmv-preload] Direct loading Unicode WebAudio via Node.js fs: ${url}`);
              const buf = origReadFileSync.call(fs, resolved);
              const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
              this._onXhrLoad({ status: 200, response: arrayBuffer });
              return;
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
          const resolved = resolveGamePath(url);
          const exists = resolved && origExistsSync.call(fs, resolved);
          const hasSpecial = /[^\x00-\x7F]/.test(url || '') || (resolved && /[^\x00-\x7F]/.test(resolved)) || (url && url.includes('%'));

          if (hasSpecial && exists && this._audioElement) {
            try {
              console.log(`[mkmv-preload] Direct loading Unicode Html5Audio via Blob: ${url}`);
              const buf = origReadFileSync.call(fs, resolved);
              const ext = path.extname(resolved).toLowerCase();
              const mime = ext === '.ogg' ? 'audio/ogg' : (ext === '.m4a' ? 'audio/mp4' : 'audio/mpeg');
              const blob = new Blob([buf], { type: mime });
              this._isLoading = true;
              this._audioElement.src = URL.createObjectURL(blob);
              this._audioElement.load();
              return;
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

// 12. 디스크에 실재하지만 Chromium file:// 프로토콜에서 실패하는 유니코드/특수문자 이미지 Node.js 직접 복구
function setupUnicodeImageRecovery() {
  const hookTimer = setInterval(() => {
    if (window.Bitmap && window.Bitmap.prototype && window.Bitmap.prototype._requestImage) {
      if (!window.Bitmap.prototype._mkmvUnicodeHooked) {
        window.Bitmap.prototype._mkmvUnicodeHooked = true;
        const origRequestImage = window.Bitmap.prototype._requestImage;
        window.Bitmap.prototype._requestImage = function(url) {
          const targetUrl = url || '';
          const resolved = resolveGamePath(targetUrl);
          const exists = resolved && origExistsSync.call(fs, resolved);
          const hasSpecial = /[^\x00-\x7F]/.test(targetUrl) || (resolved && /[^\x00-\x7F]/.test(resolved)) || targetUrl.includes('%');

          // 유니코드/특수문자 이미지가 디스크에 실재하는 경우 Chromium C++의 에러 이벤트를 기다리지 않고 즉시 data URI로 주입
          if (hasSpecial && exists) {
            try {
              console.log(`[mkmv-preload] Direct loading Unicode image via Node.js fs: ${targetUrl}`);
              const buf = origReadFileSync.call(fs, resolved);
              const ext = path.extname(resolved).toLowerCase().replace('.', '');
              const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
              const dataUrl = `data:${mime};base64,` + buf.toString('base64');
              return origRequestImage.call(this, dataUrl);
            } catch (e) {
              console.error('[mkmv-preload] Direct image load error:', e);
            }
          }

          origRequestImage.apply(this, arguments);

          if (this._image) {
            const originalErrorListener = this._errorListener;
            const self = this;

            this._image.removeEventListener('error', originalErrorListener);
            this._image.addEventListener('error', function onImageError(e) {
              try {
                const retryUrl = url || self._url || '';
                const retryResolved = resolveGamePath(retryUrl);
                if (retryResolved && origExistsSync.call(fs, retryResolved)) {
                  console.log(`[mkmv-preload] Auto-recovering Unicode image via Node.js fs: ${retryUrl}`);
                  const buf = origReadFileSync.call(fs, retryResolved);
                  const ext = path.extname(retryResolved).toLowerCase().replace('.', '');
                  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
                  const targetImg = self._image || this || (e && e.target);
                  if (targetImg) {
                    targetImg.src = `data:${mime};base64,` + buf.toString('base64');
                    return;
                  }
                }
              } catch (err) {
                console.error('[mkmv-preload] Image recovery failed:', err);
              }

              // 디스크에 진짜 파일이 없는 경우: 원래 알만툴 에러 핸들러 호출 (더미 주입 없이 정상 에러 리포트)
              if (originalErrorListener) {
                originalErrorListener.call(self._image || this, e);
              }
            });
          }
        };
        clearInterval(hookTimer);
        console.log('[mkmv-preload] Unicode image recovery handler installed successfully');
      }
    }
  }, 50);
  setTimeout(() => clearInterval(hookTimer), 30000);
}

setupUnicodeImageRecovery();

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

// 12. 저사양 1GB 기기용 메모리 안정화 및 가비지 컬렉션(GC) 관리
function setupLowMemoryManager() {
  if (userOpt.lowMemoryMode === false) return;

  // 1. 알만툴 Bitmap._onError 안전 가드 (removeEventListener null 에러 원천 차단)
  const patchBitmapGuard = () => {
    if (window.Bitmap && window.Bitmap.prototype) {
      if (!window.Bitmap.prototype._origOnError) {
        window.Bitmap.prototype._origOnError = window.Bitmap.prototype._onError;
        window.Bitmap.prototype._onError = function() {
          if (this._image) {
            try {
              this._image.removeEventListener('load', this._loadListener);
              this._image.removeEventListener('error', this._errorListener);
            } catch (e) {}
          }
          this._loadingState = 'error';
        };
      }
      return true;
    }
    return false;
  };

  // 2. 씬 전환(메뉴 진입/퇴출 등) 시 가비지 컬렉션(GC) 안전 실행
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

  // 3. 맵 이동 및 로딩 완료 시 이전 맵 타일셋/스프라이트 메모리 즉시 수거 (연속 맵 이동 튕김 방지)
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

  let bitmapHooked = false;
  let sceneHooked = false;
  let mapHooked = false;
  const memTimer = setInterval(() => {
    if (!bitmapHooked) bitmapHooked = patchBitmapGuard();
    if (!sceneHooked) sceneHooked = patchSceneCleanup();
    if (!mapHooked) mapHooked = patchMapCleanup();
    if (bitmapHooked && sceneHooked && mapHooked) {
      clearInterval(memTimer);
      console.log('[mkmv-preload] Low memory safety guards, scene & map GC installed successfully');
    }
  }, 50);
  setTimeout(() => clearInterval(memTimer), 20000);

  // 4. 배속 플레이(Fast-Forward) 시 메모리 누적 방지: 30초마다 유휴 GC 및 메모리 로깅
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
  }, 30000);
}

setupLowMemoryManager();
