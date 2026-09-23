const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  injectResolutionStyles,
  patchGraphics,
  setupGraphicsModule
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
