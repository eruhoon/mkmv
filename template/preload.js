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

// 1. RPG Maker MV & MZ 작업 디렉토리 및 메인 모듈 경로 자동 감지
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

const gameDir = detectGameDirectory(__dirname);
const isMZ = origExistsSync.call(fs, path.join(gameDir, 'js', 'rmmz_core.js'));

try {
  process.chdir(gameDir);
} catch (e) {}

// Linux ext4 파일시스템 대소문자 불일치 대응 (Node.js fs API 가상화)
const dirCache = new Map();

function getCaseInsensitiveChild(parentDir, childName) {
  let cache = dirCache.get(parentDir);
  if (!cache) {
    try {
      const entries = origReaddirSync.call(fs, parentDir);
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

function resolveCaseInsensitive(targetPath, baseDir = gameDir) {
  if (!targetPath || typeof targetPath !== 'string') return targetPath;
  targetPath = targetPath.replace(/\uFEFF/g, '');
  if (origExistsSync.call(fs, targetPath)) return targetPath;
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
    const bakFile = resolved + '.bak';
    if (origExistsSync.call(fs, bakFile)) {
      console.warn(`[mkmv-preload] Corrupted 0-byte save detected for ${p}, restoring from ${bakFile}`);
      try {
        content = origReadFileSync.call(fs, bakFile, options);
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

// 세이브 파일 파손 방지 (원자적 쓰기 + 물리 SD 카드 fsync 플러시 + 자동 .bak 백업)
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
      // 1. 기존 정상 세이브를 .bak 백업으로 보존
      if (origExistsSync.call(fs, resolvedPath)) {
        try {
          origCopyFileSync.call(fs, resolvedPath, resolvedPath + '.bak');
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

// 사용자 정의 옵션 (config.json) 로드
let userOpt = { width: 1920, height: 1080, pixelated: true, scaling: 'fit', hideCursor: false, disableTouch: false, showFps: false, fastForward: true, fastForwardSpeed: 2 };
try {
  const configPath = path.join(__dirname, 'config.json');
  if (origExistsSync.call(fs, configPath)) {
    userOpt = Object.assign(userOpt, JSON.parse(origReadFileSync.call(fs, configPath, 'utf8')));
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
  if (userOpt.hideCursor) {
    cssText += `
    html, body, canvas, * {
      cursor: none !important;
    }
    `;
  }
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
    // 1순위: 러너 자체 번들 폰트 (자체 완결형)
    path.join(__dirname, 'fonts', 'NotoSansCJKkr-Regular.otf'),
    path.join(__dirname, 'fonts', 'NotoSansKR-Regular.otf'),
    path.join(__dirname, 'fonts', 'NotoSansKR-Regular.ttf'),
    path.join(gameDir, 'fonts', 'NotoSansCJKkr-Regular.otf'),
    path.join(gameDir, 'fonts', 'NotoSansKR-Regular.otf'),
    path.join(gameDir, 'fonts', 'NotoSansKR-Regular.ttf'),
    path.join(gameDir, 'fonts', 'LINESeedKR-Rg.ttf'),

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
