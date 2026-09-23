/**
 * mkmv Graphics & Resolution Management Module
 *
 * 기능:
 * 1. 고해상도 스케일링 및 픽셀 선명도 보정 CSS 주입 (injectResolutionStyles)
 *    - 100vw / 100vh 꽉 찬 화면, 배경색 검정(#000000) 강제
 *    - pixelated / crisp-edges / -webkit-optimize-contrast 스타일 주입
 * 2. 알만툴 Graphics 엔진 실시간 스케일링 패치 (patchGraphics)
 *    - _defaultStretchMode, _stretchEnabled, _updateRealScale
 *    - 화면 비율 옵션(fill, stretch, fit 등)에 따른 캔버스 중앙 정렬(_centerElement)
 *    - pageToCanvasX / pageToCanvasY 좌표 보정
 * 3. SceneManager.run 훅 및 윈도우 resize / load 이벤트 핸들러
 */

function injectResolutionStyles(userOpt = {}) {
  if (typeof document === 'undefined') return;

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

function patchGraphics(userOpt = {}) {
  if (typeof window === 'undefined' || !window.Graphics) return;

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

function setupGraphicsModule(options = {}) {
  const { userOpt = {} } = options;

  injectResolutionStyles(userOpt);

  if (typeof window === 'undefined') return;

  let gCleanup = null;
  const gTimer = setInterval(() => {
    if (window.Graphics) {
      patchGraphics(userOpt);
      clearInterval(gTimer);
      if (gCleanup) clearTimeout(gCleanup);
    }
  }, 30);
  gCleanup = setTimeout(() => clearInterval(gTimer), 10000);
  if (gCleanup && gCleanup.unref) gCleanup.unref();
  if (gTimer && gTimer.unref) gTimer.unref();

  let smCleanup = null;
  const smTimer = setInterval(() => {
    if (window.SceneManager && window.SceneManager.run) {
      const origRun = window.SceneManager.run;
      window.SceneManager.run = function(sceneClass) {
        patchGraphics(userOpt);
        const res = origRun.apply(this, arguments);
        patchGraphics(userOpt);
        if (window.Graphics && typeof window.Graphics._updateAllElements === 'function') {
          window.Graphics._updateAllElements();
        }
        return res;
      };
      clearInterval(smTimer);
      if (smCleanup) clearTimeout(smCleanup);
    }
  }, 30);
  smCleanup = setTimeout(() => clearInterval(smTimer), 15000);
  if (smCleanup && smCleanup.unref) smCleanup.unref();
  if (smTimer && smTimer.unref) smTimer.unref();

  window.addEventListener('load', () => {
    setTimeout(() => {
      patchGraphics(userOpt);
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
}

module.exports = {
  setupGraphicsModule,
  injectResolutionStyles,
  patchGraphics
};
