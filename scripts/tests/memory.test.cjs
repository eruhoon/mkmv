const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  setupFpsMeter,
  createFallbackFpsOverlay,
  setupLowMemoryManager
} = require('../../template/modules/memory.js');

test('createFallbackFpsOverlay attaches FPS div to DOM', () => {
  let attached = null;
  global.document = {
    getElementById: () => null,
    createElement: (tag) => ({
      id: '',
      style: {
        setProperty: () => {}
      },
      textContent: ''
    }),
    body: {
      appendChild: (el) => { attached = el; }
    }
  };
  global.performance = { now: () => 1000 };
  global.requestAnimationFrame = () => {};

  createFallbackFpsOverlay();
  assert.ok(attached);
  assert.equal(attached.id, 'mkmv-fps-counter');
});

test('setupLowMemoryManager patches Scene_Base terminate and Scene_Map onMapLoaded', () => {
  let gcCalled = 0;
  global.window = {
    gc: () => { gcCalled++; },
    Scene_Base: {
      prototype: {
        terminate: function() {}
      }
    },
    Scene_Map: {
      prototype: {
        onMapLoaded: function() {}
      }
    }
  };

  setupLowMemoryManager({ lowMemoryMode: true, gcIntervalSeconds: 0 });

  return new Promise((resolve) => {
    setTimeout(() => {
      window.Scene_Base.prototype.terminate();
      window.Scene_Map.prototype.onMapLoaded();
      setTimeout(() => {
        assert.ok(gcCalled >= 2);
        resolve();
      }, 200);
    }, 60);
  });
});
