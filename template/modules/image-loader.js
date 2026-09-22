/**
 * mkmv Image Loading & Recovery Module
 *
 * 기능:
 * 1. 2D 캔버스 willReadFrequently 가속 최적화
 * 2. Bitmap._onError 안전 가드 (리스너 해제 에러 및 크래시 방지)
 * 3. Chromium C++ FileURLLoaderFactory 버그 대응:
 *    - 디스크에 실재하는 유니코드/특수문자/퍼센트 인코딩 이미지 직접 Node.js fs 로딩
 *    - 암호화 에셋(.rpgmvp, .png_)과의 충돌 없는 안전 바이패스
 *    - 로딩 실패(net::ERR_FILE_NOT_FOUND) 시 img.onerror 자동 복구(Auto-recovering)
 * 4. 리소스 로딩 에러 상세 로거 (Graphics.printLoadingError 훅)
 */

const path = require('path');
const fs = require('fs');

function setupCanvasOptimization() {
  try {
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, attributes) {
      if (type === '2d') {
        attributes = Object.assign({}, attributes, { willReadFrequently: true });
      }
      return origGetContext.call(this, type, attributes);
    };
  } catch (e) {}

  // CanvasRenderingContext2D getImageData / putImageData 안전 가드
  // Chromium 108+ Web IDL 엄격성: float / NaN / undefined 인자 전달 시
  // "Value is not of type 'long'" 예외가 발생하여 알만툴 인터프리터 및 렌더링이 중단되는 문제 방지
  try {
    if (typeof CanvasRenderingContext2D !== 'undefined') {
      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
        let x = Math.floor(Number(sx));
        let y = Math.floor(Number(sy));
        let w = Math.floor(Number(sw));
        let h = Math.floor(Number(sh));

        if (!Number.isFinite(x)) x = 0;
        if (!Number.isFinite(y)) y = 0;
        if (!Number.isFinite(w) || w <= 0) w = 1;
        if (!Number.isFinite(h) || h <= 0) h = 1;

        const canvasW = this.canvas ? this.canvas.width : 0;
        const canvasH = this.canvas ? this.canvas.height : 0;
        if (canvasW <= 0 || canvasH <= 0) {
          try {
            return this.createImageData(w, h);
          } catch (e) {
            return new ImageData(w, h);
          }
        }

        try {
          return origGetImageData.call(this, x, y, w, h);
        } catch (err) {
          try {
            return this.createImageData(w, h);
          } catch (e) {
            return new ImageData(w, h);
          }
        }
      };

      const origPutImageData = CanvasRenderingContext2D.prototype.putImageData;
      CanvasRenderingContext2D.prototype.putImageData = function(imageData, dx, dy) {
        let x = Math.floor(Number(dx));
        let y = Math.floor(Number(dy));
        if (!Number.isFinite(x)) x = 0;
        if (!Number.isFinite(y)) y = 0;
        try {
          return origPutImageData.call(this, imageData, x, y);
        } catch (err) {}
      };
    }
  } catch (e) {}
}

function setupBitmapGuard() {
  const patchGuard = () => {
    if (window.Bitmap && window.Bitmap.prototype) {
      if (!window.Bitmap.prototype._mkmvSafeOnError) {
        window.Bitmap.prototype._mkmvSafeOnError = true;
        const origOnError = window.Bitmap.prototype._onError;
        window.Bitmap.prototype._onError = function() {
          if (this._image) {
            try {
              this._image.removeEventListener('load', this._loadListener);
              this._image.removeEventListener('error', this._errorListener);
            } catch (e) {}
          }
          this._loadingState = 'error';
          if (origOnError) {
            try { origOnError.apply(this, arguments); } catch (e) {}
          }
        };

        // getPixel / getAlphaPixel 부동소수점/NaN/범위초과 가드 (플러그인 충돌 방지)
        const origGetPixel = window.Bitmap.prototype.getPixel;
        window.Bitmap.prototype.getPixel = function(x, y) {
          x = Math.floor(Number(x));
          y = Math.floor(Number(y));
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || !this.width || !this.height || x >= this.width || y >= this.height || !this._context) {
            return '#000000';
          }
          try {
            return origGetPixel.call(this, x, y);
          } catch (e) {
            return '#000000';
          }
        };

        const origGetAlphaPixel = window.Bitmap.prototype.getAlphaPixel;
        window.Bitmap.prototype.getAlphaPixel = function(x, y) {
          x = Math.floor(Number(x));
          y = Math.floor(Number(y));
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || !this.width || !this.height || x >= this.width || y >= this.height || !this._context) {
            return 0;
          }
          try {
            return origGetAlphaPixel.call(this, x, y);
          } catch (e) {
            return 0;
          }
        };
      }
      return true;
    }
    return false;
  };

  if (!patchGuard()) {
    const timer = setInterval(() => {
      if (patchGuard()) clearInterval(timer);
    }, 50);
    setTimeout(() => clearInterval(timer), 15000);
  }
}

function setupResourceErrorLogger(gameDir) {
  const hookTimer = setInterval(() => {
    if (window.Graphics && typeof window.Graphics.printLoadingError === 'function') {
      if (!window.Graphics._mkmvHooked) {
        window.Graphics._mkmvHooked = true;
        const origPrintLoadingError = window.Graphics.printLoadingError;
        window.Graphics.printLoadingError = function(url) {
          console.error(`[mkmv-resource-error] Failed to load resource: ${url}`);
          try {
            if (gameDir) {
              console.error(`[mkmv-resource-error] Target path: ${path.join(gameDir, url)}`);
            }
          } catch (e) {}
          return origPrintLoadingError.apply(this, arguments);
        };
        clearInterval(hookTimer);
        console.log('[mkmv-image] Resource loading error logger installed');
      }
    }
  }, 50);
  setTimeout(() => clearInterval(hookTimer), 30000);
}

function setupUnicodeImageRecovery({ resolveGamePath, origExistsSync, origReadFileSync }) {
  const hookTimer = setInterval(() => {
    if (window.Bitmap && window.Bitmap.prototype && window.Bitmap.prototype._requestImage) {
      if (!window.Bitmap.prototype._mkmvUnicodeHooked) {
        window.Bitmap.prototype._mkmvUnicodeHooked = true;
        const origRequestImage = window.Bitmap.prototype._requestImage;

        window.Bitmap.prototype._requestImage = function(url) {
          const targetUrl = url || '';

          // 1. Data URI 또는 Blob URL은 이미 인메모리 처리된 이미지이므로 바이패스
          if (targetUrl.startsWith('data:') || targetUrl.startsWith('blob:')) {
            return origRequestImage.apply(this, arguments);
          }

          // 2. 알만툴 MV 자체 리소스 암호화가 활성화된 경우 Decrypter 루틴으로 바이패스
          const isEncryptedGame = window.Decrypter && window.Decrypter.hasEncryptedImages && !window.Decrypter.checkImgIgnore(targetUrl);
          const resolved = resolveGamePath(targetUrl);
          const exists = resolved && origExistsSync.call(fs, resolved);
          const isEncryptedExt = resolved && (resolved.endsWith('.rpgmvp') || resolved.endsWith('.png_'));
          const hasSpecial = /[^\x00-\x7F]/.test(targetUrl) || (resolved && /[^\x00-\x7F]/.test(resolved)) || targetUrl.includes('%');

          // 순수 유니코드/특수문자 이미지 파일에 한해 Node.js fs로 즉시 data URI 주입
          if (!isEncryptedGame && !isEncryptedExt && hasSpecial && exists) {
            try {
              const buf = origReadFileSync.call(fs, resolved);
              const isRpgmvHeader = buf.length >= 16 && buf[0] === 0x52 && buf[1] === 0x50 && buf[2] === 0x47 && buf[3] === 0x4D && buf[4] === 0x56;
              if (!isRpgmvHeader) {
                console.log(`[mkmv-image] Direct loading Unicode image via Node.js fs: ${targetUrl}`);
                const ext = path.extname(resolved).toLowerCase().replace('.', '');
                const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
                const dataUrl = `data:${mime};base64,` + buf.toString('base64');
                return origRequestImage.call(this, dataUrl);
              }
            } catch (e) {
              console.error('[mkmv-image] Direct image load error:', e);
            }
          }

          origRequestImage.apply(this, arguments);

          // 3. 로딩 실패 시 img.onerror 자동 복구 핸들러
          if (this._image) {
            const originalErrorListener = this._errorListener;
            const self = this;

            this._image.removeEventListener('error', originalErrorListener);
            this._image.addEventListener('error', function onImageError(e) {
              try {
                const retryUrl = url || self._url || '';
                if (retryUrl.startsWith('data:') || retryUrl.startsWith('blob:')) {
                  if (originalErrorListener) {
                    originalErrorListener.call(self._image || this, e);
                  }
                  return;
                }
                const retryResolved = resolveGamePath(retryUrl);
                const retryEncrypted = retryResolved && (retryResolved.endsWith('.rpgmvp') || retryResolved.endsWith('.png_'));
                if (!isEncryptedGame && !retryEncrypted && retryResolved && origExistsSync.call(fs, retryResolved)) {
                  const buf = origReadFileSync.call(fs, retryResolved);
                  const isRpgmvHeader = buf.length >= 16 && buf[0] === 0x52 && buf[1] === 0x50 && buf[2] === 0x47 && buf[3] === 0x4D && buf[4] === 0x56;
                  if (!isRpgmvHeader) {
                    console.log(`[mkmv-image] Auto-recovering Unicode image via Node.js fs: ${retryUrl}`);
                    const ext = path.extname(retryResolved).toLowerCase().replace('.', '');
                    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
                    const targetImg = self._image || this || (e && e.target);
                    if (targetImg) {
                      targetImg.src = `data:${mime};base64,` + buf.toString('base64');
                      return;
                    }
                  }
                }
              } catch (err) {
                console.error('[mkmv-image] Image recovery failed:', err);
              }

              // 실제 파일이 없거나 복구 불가 시 원래 에러 핸들러 호출
              if (originalErrorListener) {
                originalErrorListener.call(self._image || this, e);
              }
            });
          }
        };

        clearInterval(hookTimer);
        console.log('[mkmv-image] Unicode image recovery handler installed');
      }
    }
  }, 50);
  setTimeout(() => clearInterval(hookTimer), 30000);
}

function setupHtmlImageElementRecovery({ resolveGamePath, origExistsSync, origReadFileSync, gameDir }) {
  if (typeof HTMLImageElement === 'undefined') return;

  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (!desc || !desc.set) {
    console.warn('[mkmv-image] HTMLImageElement.prototype.src descriptor not found');
    return;
  }

  const origSrcSet = desc.set;
  const origSrcGet = desc.get;

  function toDataUrlIfUnicode(inputUrl) {
    if (!inputUrl || typeof inputUrl !== 'string') return inputUrl;
    if (inputUrl.startsWith('data:') || inputUrl.startsWith('blob:')) return inputUrl;

    const isEncryptedGame = window.Decrypter && window.Decrypter.hasEncryptedImages && !window.Decrypter.checkImgIgnore(inputUrl);
    let resolved = resolveGamePath(inputUrl);
    if (!resolved && gameDir && !path.isAbsolute(inputUrl)) {
      resolved = path.resolve(gameDir, inputUrl);
    }
    const isEncryptedExt = resolved && (resolved.endsWith('.rpgmvp') || resolved.endsWith('.png_'));
    if (isEncryptedGame || isEncryptedExt) return inputUrl;

    const hasSpecial = /[^\x00-\x7F]/.test(inputUrl) || (resolved && /[^\x00-\x7F]/.test(resolved)) || inputUrl.includes('%');
    if (hasSpecial && resolved && origExistsSync.call(fs, resolved)) {
      try {
        const buf = origReadFileSync.call(fs, resolved);
        const isRpgmvHeader = buf.length >= 16 && buf[0] === 0x52 && buf[1] === 0x50 && buf[2] === 0x47 && buf[3] === 0x4D && buf[4] === 0x56;
        if (!isRpgmvHeader) {
          console.log(`[mkmv-image] Direct loading Unicode HTMLImageElement: ${inputUrl}`);
          const ext = path.extname(resolved).toLowerCase().replace('.', '');
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
          return `data:${mime};base64,` + buf.toString('base64');
        }
      } catch (e) {
        console.error('[mkmv-image] HTMLImageElement direct load failed:', e);
      }
    }
    return inputUrl;
  }

  try {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      enumerable: desc.enumerable !== undefined ? desc.enumerable : true,
      get: function() {
        return origSrcGet ? origSrcGet.call(this) : this.getAttribute('src');
      },
      set: function(val) {
        this._mkmvOriginalSrc = val;
        const converted = toDataUrlIfUnicode(val);
        origSrcSet.call(this, converted);
      }
    });
  } catch (e) {
    console.error('[mkmv-image] Failed to hook HTMLImageElement.prototype.src:', e);
  }

  try {
    const origSetAttribute = HTMLImageElement.prototype.setAttribute;
    HTMLImageElement.prototype.setAttribute = function(name, value) {
      if (typeof name === 'string' && name.toLowerCase() === 'src') {
        this._mkmvOriginalSrc = value;
        const converted = toDataUrlIfUnicode(value);
        return origSetAttribute.call(this, name, converted);
      }
      return origSetAttribute.apply(this, arguments);
    };
  } catch (e) {}

  // 글로벌 capture-phase 이미지 에러 자동 복구 리스너 (PIXI/3rd-party 이미지 로더 실패 방지)
  try {
    window.addEventListener('error', function(e) {
      const target = e.target;
      if (target && (target instanceof HTMLImageElement || target.tagName === 'IMG')) {
        if (target._mkmvRecovered) return;
        const rawSrc = target._mkmvOriginalSrc || target.getAttribute('src') || target.src || '';
        if (!rawSrc || rawSrc.startsWith('data:') || rawSrc.startsWith('blob:')) return;

        const isEncryptedGame = window.Decrypter && window.Decrypter.hasEncryptedImages && !window.Decrypter.checkImgIgnore(rawSrc);
        let resolved = resolveGamePath(rawSrc);
        if (!resolved && gameDir && !path.isAbsolute(rawSrc)) {
          resolved = path.resolve(gameDir, rawSrc);
        }
        const isEncryptedExt = resolved && (resolved.endsWith('.rpgmvp') || resolved.endsWith('.png_'));
        if (!isEncryptedGame && !isEncryptedExt && resolved && origExistsSync.call(fs, resolved)) {
          try {
            const buf = origReadFileSync.call(fs, resolved);
            const isRpgmvHeader = buf.length >= 16 && buf[0] === 0x52 && buf[1] === 0x50 && buf[2] === 0x47 && buf[3] === 0x4D && buf[4] === 0x56;
            if (!isRpgmvHeader) {
              target._mkmvRecovered = true;
              e.preventDefault();
              e.stopImmediatePropagation();
              console.log(`[mkmv-image] Auto-recovering failed HTMLImageElement via Node.js fs: ${rawSrc}`);
              const ext = path.extname(resolved).toLowerCase().replace('.', '');
              const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
              origSrcSet.call(target, `data:${mime};base64,` + buf.toString('base64'));
              return;
            }
          } catch (err) {
            console.error('[mkmv-image] HTMLImageElement error recovery failed:', err);
          }
        }
      }
    }, true);
  } catch (e) {}

  console.log('[mkmv-image] HTMLImageElement Unicode recovery handler installed');
}

function setupCanvasMeshCompatibility() {
  const patchMesh = () => {
    let meshPatched = false;

    // 1. Mesh.prototype._renderCanvas 훅: 렌더링 직전 canvasPadding을 1.5로 강제 지정
    if (window.PIXI && window.PIXI.mesh && window.PIXI.mesh.Mesh && window.PIXI.mesh.Mesh.prototype) {
      if (!window.PIXI.mesh.Mesh.prototype._mkmvRenderHooked) {
        window.PIXI.mesh.Mesh.prototype._mkmvRenderHooked = true;
        const origRenderCanvas = window.PIXI.mesh.Mesh.prototype._renderCanvas;
        window.PIXI.mesh.Mesh.prototype._renderCanvas = function(renderer) {
          this.canvasPadding = Math.max(this.canvasPadding || 0, 1.5);
          // PIXI 4.5's Canvas mesh renderer does not set globalAlpha, unlike
          // its sprite renderer. Otherwise meshes inherit the preceding
          // sprite's opacity (e.g. a fading picture hides a Spine body while
          // the face, rendered as a sprite, remains visible).
          renderer.context.globalAlpha = this.worldAlpha;
          return origRenderCanvas.apply(this, arguments);
        };
        console.log('[mkmv-image] Canvas mesh opacity and padding hooks installed');
      }
      meshPatched = true;
    }

    // 2. CanvasMeshRenderer.prototype._renderDrawTriangle 훅: 음수 스케일(반전) 버그 보정 및 1.5px 패딩 보장
    const CanvasMeshRenderer = (window.PIXI && window.PIXI.mesh && window.PIXI.mesh.CanvasMeshRenderer)
      || (window.PIXI && window.PIXI.CanvasRenderer && window.PIXI.CanvasRenderer.__plugins && window.PIXI.CanvasRenderer.__plugins.mesh);
    if (CanvasMeshRenderer && CanvasMeshRenderer.prototype && !CanvasMeshRenderer.prototype._mkmvTriangleHooked) {
      CanvasMeshRenderer.prototype._mkmvTriangleHooked = true;
      const origDrawTriangle = CanvasMeshRenderer.prototype._renderDrawTriangle;
      CanvasMeshRenderer.prototype._renderDrawTriangle = function(mesh, index0, index1, index2) {
        if (!mesh.canvasPadding || mesh.canvasPadding < 1.5) {
          mesh.canvasPadding = 1.5;
        }
        // 음수 스케일(Flip)일 때 삼각형이 안쪽으로 찌그러지는 PIXI 버그 방지
        const wt = mesh.worldTransform;
        if (wt && (wt.a < 0 || wt.d < 0)) {
          const origA = wt.a;
          const origD = wt.d;
          wt.a = Math.abs(origA);
          wt.d = Math.abs(origD);
          try {
            return origDrawTriangle.apply(this, arguments);
          } finally {
            wt.a = origA;
            wt.d = origD;
          }
        }
        return origDrawTriangle.apply(this, arguments);
      };
      console.log('[mkmv-image] CanvasMeshRenderer._renderDrawTriangle hook installed');
    }

    // 3. SpineMesh 및 Spine 객체 후킹 (Spine이 지연 로드될 때까지 타이머 유지)
    const spineObj = (window.PIXI && window.PIXI.spine) || window.pixi_spine;
    let spinePatched = false;
    if (spineObj && spineObj.Spine && spineObj.Spine.prototype) {
      if (!spineObj.Spine.prototype._mkmvMeshHooked) {
        spineObj.Spine.prototype._mkmvMeshHooked = true;
        const origNewMesh = spineObj.Spine.prototype.newMesh;
        if (origNewMesh) {
          spineObj.Spine.prototype.newMesh = function() {
            const mesh = origNewMesh.apply(this, arguments);
            if (mesh) mesh.canvasPadding = 1.5;
            return mesh;
          };
        }
        console.log('[mkmv-image] Spine.prototype.newMesh hook installed');
      }
      spinePatched = true;
    }

    return meshPatched && spinePatched;
  };

  if (!patchMesh()) {
    const timer = setInterval(() => {
      if (patchMesh()) clearInterval(timer);
    }, 50);
    setTimeout(() => clearInterval(timer), 30000);
  }
}

function setupImageLoader(options = {}) {
  const { resolveGamePath, origExistsSync, origReadFileSync, gameDir } = options;
  setupCanvasOptimization();
  setupCanvasMeshCompatibility();
  setupBitmapGuard();
  setupResourceErrorLogger(gameDir);
  setupUnicodeImageRecovery({ resolveGamePath, origExistsSync, origReadFileSync });
  setupHtmlImageElementRecovery({ resolveGamePath, origExistsSync, origReadFileSync, gameDir });
}

module.exports = {
  setupImageLoader,
  setupCanvasMeshCompatibility
};
