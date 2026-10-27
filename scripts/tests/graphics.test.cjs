const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  injectResolutionStyles,
  patchGraphics,
  setupGraphicsModule,
  patchSpriteOptimization,
  patchMinimapOptimization
} = require('../../template/modules/graphics.js');

test('injectResolutionStyles adds style tag with pixelated rules', () => {
  let appended = null;
  global.document = {
    createElement: (tag) => ({ tagName: tag, style: {} }),
    head: {
      appendChild: (el) => { appended = el; }
    }
  };

  injectResolutionStyles({ pixelated: true });
  assert.ok(appended);
  assert.equal(appended.id, 'mkmv-resolution-fix');
  assert.match(appended.textContent, /image-rendering: pixelated/);
});

test('patchGraphics configures Graphics scaling and centerElement', () => {
  global.window = {
    innerWidth: 1280,
    innerHeight: 720,
    Graphics: {
      _width: 816,
      _height: 624
    }
  };

  patchGraphics({ scaling: 'fit' });
  assert.equal(window.Graphics._defaultStretchMode(), true);
  assert.equal(window.Graphics._stretchEnabled, true);

  window.Graphics._updateRealScale();
  assert.ok(window.Graphics._realScale > 0);

  const element = { style: {} };
  window.Graphics._centerElement(element);
  assert.equal(element.style.position, 'absolute');
  assert.equal(element.style.margin, 'auto');
});

test('patchSpriteOptimization avoids redundant canvas width/height reallocations', () => {
  let widthSetCount = 0;
  let heightSetCount = 0;
  class MockCanvas {
    constructor() {
      this._w = 0;
      this._h = 0;
    }
    get width() { return this._w; }
    set width(val) { widthSetCount++; this._w = val; }
    get height() { return this._h; }
    set height(val) { heightSetCount++; this._h = val; }
    getContext() { return {}; }
  }

  global.document = {
    createElement: (tag) => (tag === 'canvas' ? new MockCanvas() : {})
  };
  global.PIXI = {
    BaseTexture: class { constructor(c) { this.width = c.width; this.height = c.height; } }
  };

  function MockSprite() {}
  MockSprite.prototype._createTinter = function(w, h) {
    if (!this._canvas) {
      this._canvas = document.createElement('canvas');
      this._context = this._canvas.getContext('2d');
    }
    this._canvas.width = w;
    this._canvas.height = h;
  };

  global.window = { Sprite: MockSprite };

  patchSpriteOptimization();

  const sprite = new MockSprite();
  sprite._createTinter(32, 32);
  assert.equal(widthSetCount, 1);
  assert.equal(heightSetCount, 1);

  // Second call with same dimensions should not reassign width/height
  sprite._createTinter(32, 32);
  assert.equal(widthSetCount, 1);
  assert.equal(heightSetCount, 1);
});

test('patchMinimapOptimization redirects KMS_Minimap setBlendColor to opacity', () => {
  class MockMinimapIcon {
    constructor() {
      this.opacity = 255;
      this._blendColor = [0, 0, 0, 0];
      this._blinkDuration = 0;
    }
    setBlendColor(col) {
      this._blendColor = col;
    }
    updateBlink() {
      this.setBlendColor([255, 255, 255, 128]);
    }
  }

  const icon = new MockMinimapIcon();
  const mockMinimap = {
    _objectSprites: [icon]
  };

  global.window = {
    SceneManager: {
      _scene: {
        _spriteset: {
          _minimap: mockMinimap
        }
      }
    }
  };

  patchMinimapOptimization();

  // updateBlink should now update opacity rather than blendColor
  icon.updateBlink();
  assert.deepEqual(icon._blendColor, [0, 0, 0, 0]);
  assert.ok(icon.opacity > 0 && icon.opacity <= 255);
});
