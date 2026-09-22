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
