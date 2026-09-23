/**
 * mkmv Font Management Module
 *
 * 기능:
 * 1. Noto Sans CJK KR 자동 폴백 폰트 시스템
 *    - 게임 번들, 런타임 공유 번들, PortMaster 공유 경로에서 CJK 폰트 탐색
 *    - FontFace API를 통한 가상 폰트 패밀리(GameFont, Noto Sans CJK KR, Dotum, rmmz-mainfont 등) 등록
 *    - Window_Base 및 Bitmap의 standardFontFace / _makeFontNameText 패치
 * 2. 부팅 폰트 검사 무한 대기 방지 가드
 *    - Graphics.isFontLoaded, Scene_Boot.prototype.isGameFontLoaded 가드
 *    - FontManager.throwLoadError 억제
 */

const path = require('path');
const fs = require('fs');
const { createLogger } = require('./logger.js');
const logger = createLogger('mkmv-font');

function setupFallbackFont(options = {}) {
  const {
    runtimeDir = __dirname,
    gameDir = process.cwd(),
    gameRootDir = gameDir,
    origExistsSync = fs.existsSync,
    origReadFileSync = fs.readFileSync
  } = options;

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
    logger.debug('No fallback CJK font file found');
    return;
  }

  if (typeof FontFace !== 'undefined' && typeof document !== 'undefined' && document.fonts) {
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
            logger.warn(`Failed to load FontFace ${family}:`, err);
          });
        } catch (err) {}
      });

      logger.info(`Successfully registered fallback font (${path.basename(fontPath)}) as ${fontFamilies.join(', ')}`);
    } catch (e) {
      logger.warn('Error reading fallback font file:', e);
    }
  }

  const patchFontChain = () => {
    if (typeof window === 'undefined') return;

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

  if (typeof window !== 'undefined') {
    let cleanupTimer = null;
    const fontTimer = setInterval(() => {
      if (window.Window_Base || window.Bitmap) {
        patchFontChain();
        clearInterval(fontTimer);
        if (cleanupTimer) clearTimeout(cleanupTimer);
      }
    }, 30);
    cleanupTimer = setTimeout(() => clearInterval(fontTimer), 10000);
    if (cleanupTimer && cleanupTimer.unref) cleanupTimer.unref();
    if (fontTimer && fontTimer.unref) fontTimer.unref();
  }
}

function patchFontReady() {
  if (typeof window === 'undefined') return;

  if (window.Graphics) {
    window.Graphics.isFontLoaded = function() { return true; };
  }
  if (window.Scene_Boot && window.Scene_Boot.prototype) {
    window.Scene_Boot.prototype.isGameFontLoaded = function() { return true; };
  }
  if (window.FontManager) {
    window.FontManager.throwLoadError = function(family) {
      logger.warn(`Suppressed FontManager LoadError for ${family}`);
    };
  }
}

function setupFontReadyGuard() {
  if (typeof window === 'undefined') return;

  let cleanupTimer = null;
  const fontReadyTimer = setInterval(() => {
    patchFontReady();
    if (window.Scene_Boot && window.Scene_Boot.prototype && window.Scene_Boot.prototype.isGameFontLoaded) {
      patchFontReady();
      clearInterval(fontReadyTimer);
      if (cleanupTimer) clearTimeout(cleanupTimer);
    }
  }, 20);
  cleanupTimer = setTimeout(() => clearInterval(fontReadyTimer), 15000);
  if (cleanupTimer && cleanupTimer.unref) cleanupTimer.unref();
  if (fontReadyTimer && fontReadyTimer.unref) fontReadyTimer.unref();
}

function setupFontModule(options = {}) {
  setupFallbackFont(options);
  setupFontReadyGuard();
}

module.exports = {
  setupFontModule,
  setupFallbackFont,
  patchFontReady,
  setupFontReadyGuard
};
