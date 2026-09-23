const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  setupFontModule,
  patchFontReady,
  setupFallbackFont
} = require('../../template/modules/font.js');

test('patchFontReady suppresses FontManager error and flags fonts loaded', () => {
  global.window = {
    Graphics: {},
    Scene_Boot: {
      prototype: {}
    },
    FontManager: {}
  };

  patchFontReady();

  assert.equal(window.Graphics.isFontLoaded(), true);
  assert.equal(window.Scene_Boot.prototype.isGameFontLoaded(), true);

  let suppressed = false;
  window.FontManager.throwLoadError('TestFont');
  // It shouldn't throw error
  assert.equal(typeof window.FontManager.throwLoadError, 'function');
});

test('setupFallbackFont patches Window_Base and Bitmap font chains', () => {
  global.window = {
    Window_Base: {
      prototype: {
        standardFontFace: () => 'GameFont'
      }
    },
    Bitmap: {
      prototype: {
        _makeFontNameText: () => 'GameFont'
      }
    }
  };

  // Mock document and FontFace
  const addedFonts = [];
  global.document = {
    fonts: {
      add: (face) => addedFonts.push(face)
    }
  };
  global.FontFace = function(family, buffer) {
    this.family = family;
    this.buffer = buffer;
    this.load = async () => this;
  };

  const fakeFs = {
    existsSync: () => true,
    readFileSync: () => Buffer.from('fake-font-data')
  };

  setupFallbackFont({
    runtimeDir: '/mock/runtime',
    gameDir: '/mock/game',
    gameRootDir: '/mock/game',
    origExistsSync: fakeFs.existsSync,
    origReadFileSync: fakeFs.readFileSync
  });

  // Give setInterval a brief moment to run patchFontChain
  return new Promise((resolve) => {
    setTimeout(() => {
      const patchedWindowBase = window.Window_Base.prototype.standardFontFace();
      assert.match(patchedWindowBase, /Noto Sans CJK KR/);

      const patchedBitmap = window.Bitmap.prototype._makeFontNameText();
      assert.match(patchedBitmap, /Noto Sans CJK KR/);
      resolve();
    }, 60);
  });
});
