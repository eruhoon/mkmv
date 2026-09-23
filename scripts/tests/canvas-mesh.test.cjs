const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setupCanvasMeshCompatibility } = require('../../template/modules/image-loader.js');

function install() {
  function Mesh() {}
  const drawn = [];
  Mesh.prototype._renderCanvas = function(renderer, token) {
    drawn.push(renderer.context.globalAlpha);
    return token;
  };
  const webgl = Mesh.prototype._renderWebGL = function() {};
  function Spine() {}
  Spine.prototype.newMesh = () => new Mesh();
  global.window = { PIXI: { mesh: { Mesh }, spine: { Spine } } };
  setupCanvasMeshCompatibility();
  return { Mesh, drawn, webgl };
}

test('opaque mesh does not inherit a preceding almost-transparent sprite', () => {
  const { Mesh, drawn } = install();
  const mesh = new Mesh();
  mesh.worldAlpha = 1;
  const renderer = { context: { globalAlpha: 0.001 } };
  const token = {};
  assert.equal(mesh._renderCanvas(renderer, token), token);
  assert.deepEqual(drawn, [1]);
});

test('each mesh uses its world opacity, including parent fades', () => {
  const { Mesh, drawn } = install();
  const renderer = { context: { globalAlpha: 1 } };
  for (const alpha of [0.25, 1, 0, 0.5]) {
    const mesh = new Mesh();
    mesh.worldAlpha = alpha;
    mesh.alpha = 1;
    mesh._renderCanvas(renderer);
  }
  assert.deepEqual(drawn, [0.25, 1, 0, 0.5]);
});

test('install is idempotent and preserves WebGL and existing padding', () => {
  const { Mesh, drawn, webgl } = install();
  const installed = Mesh.prototype._renderCanvas;
  setupCanvasMeshCompatibility();
  assert.equal(Mesh.prototype._renderCanvas, installed);
  assert.equal(Mesh.prototype._renderWebGL, webgl);
  const mesh = new Mesh();
  mesh.worldAlpha = 1;
  mesh.canvasPadding = 3;
  mesh._renderCanvas({ context: { globalAlpha: 0 } });
  assert.equal(mesh.canvasPadding, 3);
  assert.deepEqual(drawn, [1]);
});

test('Bitmap.prototype.getPixel and getAlphaPixel support MV and MZ context models', () => {
  const { setupBitmapGuard } = require('../../template/modules/image-loader.js');

  // 1. RPG Maker MV model (direct this._context)
  function MvBitmap(width, height) {
    this.width = width;
    this.height = height;
    this._context = {
      getImageData: (x, y) => ({ data: [255, 0, 0, 255] })
    };
  }
  MvBitmap.prototype.getPixel = function(x, y) {
    return '#ff0000';
  };
  MvBitmap.prototype.getAlphaPixel = function(x, y) {
    return 255;
  };

  global.window = { Bitmap: MvBitmap };
  setupBitmapGuard();

  const mvBmp = new MvBitmap(100, 100);
  assert.equal(mvBmp.getPixel(10.5, 20.3), '#ff0000');
  assert.equal(mvBmp.getAlphaPixel(10.5, 20.3), 255);
  // Out of bounds or NaN
  assert.equal(mvBmp.getPixel(-1, 0), '#000000');
  assert.equal(mvBmp.getPixel(NaN, 0), '#000000');
  assert.equal(mvBmp.getPixel(200, 0), '#000000');
  assert.equal(mvBmp.getAlphaPixel(-1, 0), 0);

  // 2. RPG Maker MZ model (lazy this.context getter)
  function MzBitmap(width, height) {
    this.width = width;
    this.height = height;
    this._context = null;
  }
  Object.defineProperty(MzBitmap.prototype, 'context', {
    get: function() {
      if (!this._context) {
        this._context = {
          getImageData: (x, y) => ({ data: [255, 255, 255, 255] })
        };
      }
      return this._context;
    },
    configurable: true
  });
  MzBitmap.prototype.getPixel = function(x, y) {
    return '#ffffff';
  };
  MzBitmap.prototype.getAlphaPixel = function(x, y) {
    return 255;
  };

  global.window = { Bitmap: MzBitmap };
  setupBitmapGuard();

  const mzBmp = new MzBitmap(100, 100);
  // Before fix, this._context was null so it returned #000000 instead of #ffffff!
  assert.equal(mzBmp.getPixel(10, 10), '#ffffff');
  assert.equal(mzBmp.getAlphaPixel(10, 10), 255);
  assert.ok(mzBmp._context !== null, 'MZ context should have been lazy initialized');
});

