const Module = require('module');
const path = require('path');
const fs = require('fs');
const originalRequire = Module.prototype.require;

// 사용자 정의 옵션 (config.json) 로드
let userOpt = { width: 1920, height: 1080, pixelated: true, scaling: 'fit' };
try {
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    userOpt = Object.assign(userOpt, JSON.parse(fs.readFileSync(configPath, 'utf8')));
  }
} catch (e) {}

// Native window resize & move prevention (Community_Basic.js 등 플러그인의 창 축소 원천 차단)
const noop = (...args) => {
  console.log('[mkmv-preload] Intercepted window resize/move attempt:', ...args);
};
window.resizeTo = noop;
window.resizeBy = noop;
window.moveTo = noop;
window.moveBy = noop;

try {
  Object.defineProperties(window, {
    resizeTo: { value: noop, writable: false, configurable: false },
    resizeBy: { value: noop, writable: false, configurable: false },
    moveTo: { value: noop, writable: false, configurable: false },
    moveBy: { value: noop, writable: false, configurable: false }
  });
} catch (e) {}

// 1. RPG Maker MV 작업 디렉토리 및 메인 모듈 경로 설정
const wwwPath = path.join(__dirname, 'www');
try {
  process.chdir(wwwPath);
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

// 5. 고해상도(1080p/720p) 스케일링 및 픽셀 선명도 보정 CSS 주입
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

  const isFill = (userOpt.scaling === 'fill');

  window.Graphics._updateRealScale = function() {
    this._stretchEnabled = true;
    const h = window.innerWidth / this._width;
    const v = window.innerHeight / this._height;
    this._realScale = isFill ? Math.max(h, v) : Math.min(h, v);
  };

  window.Graphics._centerElement = function(element) {
    if (!element) return;
    element.style.position = 'absolute';
    element.style.margin = 'auto';
    element.style.top = '0px';
    element.style.left = '0px';
    element.style.right = '0px';
    element.style.bottom = '0px';

    if (isFill) {
      element.style.width = window.innerWidth + 'px';
      element.style.height = window.innerHeight + 'px';
    } else {
      const width = Math.round(element.width * this._realScale);
      const height = Math.round(element.height * this._realScale);
      element.style.width = width + 'px';
      element.style.height = height + 'px';
    }
  };

  if (isFill) {
    window.Graphics.pageToCanvasX = function(x) {
      if (this._canvas) {
        return Math.round(x / (window.innerWidth / this._width));
      }
      return 0;
    };
    window.Graphics.pageToCanvasY = function(y) {
      if (this._canvas) {
        return Math.round(y / (window.innerHeight / this._height));
      }
      return 0;
    };
  }

  if (typeof window.Graphics._updateAllElements === 'function') {
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
    if (window.Graphics && typeof window.Graphics._updateAllElements === 'function') {
      window.Graphics._updateAllElements();
    }
    window.dispatchEvent(new Event('resize'));
  }, 100);
});

window.addEventListener('resize', () => {
  if (window.Graphics && typeof window.Graphics._updateAllElements === 'function') {
    window.Graphics._updateAllElements();
  }
});
