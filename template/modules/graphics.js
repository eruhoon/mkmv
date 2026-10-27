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

function patchSpriteOptimization() {
  if (typeof window === 'undefined') return;

  // Sprite._createTinter 불필요한 캔버스 리셋 방지 최적화
  // HTML5 Canvas는 .width 또는 .height를 재할당할 때마다 내부 픽셀 버퍼를 비우고 재할당합니다.
  // 동일한 크기일 때 재할당을 건너뛰어 가비지 컬렉션 및 GPU 메모리 버퍼 단편화를 방지합니다.
  if (window.Sprite && window.Sprite.prototype) {
    const origCreateTinter = window.Sprite.prototype._createTinter;
    if (origCreateTinter && !window.Sprite.prototype._mkmvTinterOptimized) {
      window.Sprite.prototype._mkmvTinterOptimized = true;
      window.Sprite.prototype._createTinter = function(w, h) {
        if (!this._canvas) {
          this._canvas = document.createElement('canvas');
          this._context = this._canvas.getContext('2d');
        }
        if (this._canvas.width !== w) this._canvas.width = w;
        if (this._canvas.height !== h) this._canvas.height = h;

        if (!this._tintTexture) {
          this._tintTexture = new PIXI.BaseTexture(this._canvas);
        }
        this._tintTexture.width = w;
        this._tintTexture.height = h;
        if (this._bitmap && this._bitmap.baseTexture) {
          this._tintTexture.scaleMode = this._bitmap.baseTexture.scaleMode;
        }
      };
    }
  }
}

function patchMinimapOptimization() {
  if (typeof window === 'undefined') return;

  const hookObjectSprites = (sprites) => {
    if (!sprites || sprites.length === 0) return;
    const sample = sprites[0];
    if (!sample) return;
    const proto = Object.getPrototypeOf(sample);
    if (proto && proto.updateBlink && !proto._mkmvOptimized) {
      proto._mkmvOptimized = true;
      proto.updateBlink = function() {
        const blinkTime = (this.constructor.Params && this.constructor.Params.blinkTime) || 180;
        this._blinkDuration = (this._blinkDuration + 1) % blinkTime;
        const alpha = 128 * (Math.sin(this._blinkDuration * Math.PI * 2 / blinkTime) + 1);
        this.opacity = alpha;
      };
      sprites.forEach(s => {
        if (s.setBlendColor) s.setBlendColor([0, 0, 0, 0]);
      });
    }
  };

  // KMS_Minimap 플러그인 훅:
  // KMS_Minimap은 모든 맵 이벤트마다 Sprite_MinimapIcon을 생성하고
  // 매 프레임 setBlendColor([255, 255, 255, alpha])를 호출하여 2D 캔버스 틴팅 및 텍스처 재업로드를 유발합니다.
  // 맵에 수십 개의 NPC/이벤트가 있을 때 프레임이 4~6 FPS로 폭락하는 문제를 방지하기 위해
  // GPU WebGL uniform인 opacity 깜빡임으로 대체합니다.
  if (window.Spriteset_Map && window.Spriteset_Map.prototype) {
    const origCreateMinimap = window.Spriteset_Map.prototype.createMinimap;
    if (origCreateMinimap && !window.Spriteset_Map.prototype._mkmvMinimapOptimized) {
      window.Spriteset_Map.prototype._mkmvMinimapOptimized = true;
      window.Spriteset_Map.prototype.createMinimap = function() {
        origCreateMinimap.apply(this, arguments);
        if (this._minimap && this._minimap.createObjectSprites) {
          const origCreateObjectSprites = this._minimap.createObjectSprites;
          this._minimap.createObjectSprites = function() {
            origCreateObjectSprites.apply(this, arguments);
            hookObjectSprites(this._objectSprites);
          };
        }
      };
    }
  }

  // 주기적 안전 가드: 씬 전환 후 이미 생성된 미니맵 확인
  if (window.SceneManager && window.SceneManager._scene && window.SceneManager._scene._spriteset && window.SceneManager._scene._spriteset._minimap) {
    hookObjectSprites(window.SceneManager._scene._spriteset._minimap._objectSprites);
  }
}

function setupGraphicsModule(options = {}) {
  const { userOpt = {} } = options;

  injectResolutionStyles(userOpt);

  if (typeof window === 'undefined') return;

  patchSpriteOptimization();

  let gCleanup = null;
  const gTimer = setInterval(() => {
    if (window.Graphics) {
      patchGraphics(userOpt);
      patchSpriteOptimization();
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
        patchSpriteOptimization();
        const res = origRun.apply(this, arguments);
        patchGraphics(userOpt);
        patchSpriteOptimization();
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

  // KMS_Minimap 등 맵 씬 미니맵 최적화 주기적 점검
  const minimapInterval = setInterval(patchMinimapOptimization, 500);
  if (minimapInterval && minimapInterval.unref) minimapInterval.unref();

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
  patchGraphics,
  patchSpriteOptimization,
  patchMinimapOptimization
};
