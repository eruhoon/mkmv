const Module = require('module');
const path = require('path');
const fs = require('fs');
const originalRequire = Module.prototype.require;

// 1. RPG Maker MV 작업 디렉토리 및 메인 모듈 경로 설정
const wwwPath = path.join(__dirname, 'www');
try {
  process.chdir(wwwPath);
} catch (e) {}

// 원본 fs 메서드 백업 (재귀 호출 방지 및 고속 직접 접근용)
const origExistsSync = fs.existsSync;
const origReadFileSync = fs.readFileSync;
const origReadFile = fs.readFile;
const origStatSync = fs.statSync;
const origReaddirSync = fs.readdirSync;

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

function resolveCaseInsensitive(targetPath, baseDir = wwwPath) {
  if (!targetPath || typeof targetPath !== 'string') return targetPath;
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
    return origExistsSync.call(fs, resolveCaseInsensitive(p, wwwPath));
  } catch (e) {
    return origExistsSync.call(fs, p);
  }
};

fs.readFileSync = function(p, options) {
  return origReadFileSync.call(fs, resolveCaseInsensitive(p, wwwPath), options);
};

fs.statSync = function(p, options) {
  return origStatSync.call(fs, resolveCaseInsensitive(p, wwwPath), options);
};

fs.readFile = function(p, ...args) {
  return origReadFile.call(fs, resolveCaseInsensitive(p, wwwPath), ...args);
};

// 사용자 정의 옵션 (config.json) 로드
let userOpt = { width: 1920, height: 1080, pixelated: true, scaling: 'fit', hideCursor: false, disableTouch: false, showFps: false };
try {
  const configPath = path.join(__dirname, 'config.json');
  if (origExistsSync.call(fs, configPath)) {
    userOpt = Object.assign(userOpt, JSON.parse(origReadFileSync.call(fs, configPath, 'utf8')));
  }
} catch (e) {}

if (!process.mainModule) {
  process.mainModule = { filename: path.join(wwwPath, 'index.html') };
} else {
  process.mainModule.filename = path.join(wwwPath, 'index.html');
}

// 2. NW.js 호환성 객체 (알만툴 MV 필수 모듈 Shim)
const nwShim = {
  App: {
    argv: [],
    fullPath: wwwPath,
    dataPath: wwwPath,
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

Module.prototype.require = function(id) {
  if (id === 'nw.gui') {
    return nwShim;
  }
  return originalRequire.apply(this, arguments);
};

window.nw = nwShim;
window.nwGui = nwShim;

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
      const h = window.innerWidth / this._width;
      const v = window.innerHeight / this._height;
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
      const width = Math.round(element.width * this._realScale);
      const height = Math.round(element.height * this._realScale);
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
    path.join(wwwPath, 'fonts', 'NotoSansCJKkr-Regular.otf'),
    path.join(wwwPath, 'fonts', 'NotoSansKR-Regular.otf'),
    path.join(wwwPath, 'fonts', 'NotoSansKR-Regular.ttf'),
    path.join(wwwPath, 'fonts', 'LINESeedKR-Rg.ttf'),

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
      'IPAMincho'
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

  // RPG Maker MV 폰트 체인 패치 (누락된 한글/일본어/한자 글리프 자동 폴백)
  const fontChain = 'GameFont, "Noto Sans CJK KR", "NotoSansCJKkr", "Meiryo", "MS Gothic", "Yu Gothic", "Dotum", "AppleGothic", "SimHei", sans-serif';

  const patchFontChain = () => {
    if (window.Window_Base && window.Window_Base.prototype) {
      window.Window_Base.prototype.standardFontFace = function() {
        return fontChain;
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

// 7. RPG Maker MV 부팅 폰트 검사 무한 대기(Freezing / Black Screen) 방지 가드
function patchFontReady() {
  if (window.Graphics) {
    window.Graphics.isFontLoaded = function() { return true; };
  }
  if (window.Scene_Boot && window.Scene_Boot.prototype) {
    window.Scene_Boot.prototype.isGameFontLoaded = function() { return true; };
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

  if (document.body) {
    document.body.appendChild(overlay);
  } else {
    document.documentElement.appendChild(overlay);
  }

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
