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


test('setupFpsMeter stops and restarts fallback rAF loop on setVisible toggle', () => {
  const elements = new Map();
  let nextRafId = 1;
  const activeRafs = new Set();

  global.document = {
    getElementById: (id) => elements.get(id) || null,
    createElement: () => ({
      id: '',
      parentNode: null,
      style: {
        _props: {},
        setProperty(k, v) { this._props[k] = v; },
        getPropertyValue(k) { return this._props[k] || ''; }
      },
      textContent: ''
    }),
    body: {
      appendChild: (el) => {
        el.parentNode = global.document.body;
        if (el.id) elements.set(el.id, el);
      }
    }
  };
  global.window = {};
  global.performance = { now: () => 1000 };
  global.requestAnimationFrame = () => {
    const id = nextRafId++;
    activeRafs.add(id);
    return id;
  };
  global.cancelAnimationFrame = (id) => {
    activeRafs.delete(id);
  };

  const fps = setupFpsMeter({ showFps: false });
  assert.equal(fps.isVisible(), false);
  assert.equal(activeRafs.size, 0);

  fps.setVisible(true);
  assert.equal(fps.isVisible(), true);
  assert.equal(activeRafs.size, 1);

  fps.setVisible(false);
  assert.equal(fps.isVisible(), false);
  assert.equal(activeRafs.size, 0);

  fps.setVisible(true);
  assert.equal(activeRafs.size, 1);
});
