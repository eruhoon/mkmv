const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { saveGameConfig } = require('../../template/modules/config.js');
const { setupFpsMeter } = require('../../template/modules/memory.js');
const { setTargetFps } = require('../../template/modules/graphics.js');
const { triggerInput } = require('../../template/modules/input.js');
const {
  SETTING_DEFINITIONS,
  cycleSettingValue,
  setupSettingsMenu
} = require('../../template/modules/settings-menu.js');

function createMockDom() {
  const listeners = new Map();
  const elements = new Map();

  function makeEl(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      id: '',
      innerHTML: '',
      textContent: '',
      children: [],
      parentNode: null,
      style: {
        _props: {},
        setProperty(k, v) { this._props[k] = v; },
        getPropertyValue(k) { return this._props[k] || ''; }
      },
      _listeners: {},
      addEventListener(type, fn) {
        this._listeners[type] = this._listeners[type] || [];
        this._listeners[type].push(fn);
      },
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        if (child.id) elements.set(child.id, child);
        return child;
      },
      querySelector() { return null; }
    };
    return el;
  }

  const body = makeEl('body');
  const head = makeEl('head');

  const doc = {
    body,
    head,
    readyState: 'complete',
    getElementById(id) {
      return elements.get(id) || null;
    },
    createElement(tag) {
      return makeEl(tag);
    },
    addEventListener() {}
  };

  const win = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatch(type, eventObj) {
      const list = listeners.get(type) || [];
      let stoppedImmediate = false;
      const ev = Object.assign({
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        stopImmediatePropagation() { stoppedImmediate = true; this.propagationStopped = true; }
      }, eventObj);
      for (const fn of list) {
        fn(ev);
        if (stoppedImmediate) break;
      }
      return ev;
    }
  };

  return { win, doc };
}

test('saveGameConfig merges updates into gameRootDir mkmv.json without clobbering existing keys', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-menu-cfg-'));
  const runtimeDir = path.join(tmpDir, 'runtime');
  const gameDir = path.join(tmpDir, 'game');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(gameDir, { recursive: true });

  fs.writeFileSync(path.join(gameDir, 'mkmv.json'), JSON.stringify({
    customNote: 'keep-me',
    showFps: false
  }, null, 2));

  try {
    const res = saveGameConfig(runtimeDir, gameDir, { showFps: true, targetFps: 30 });
    assert.equal(res.path, path.join(gameDir, 'mkmv.json'));
    const written = JSON.parse(fs.readFileSync(res.path, 'utf8'));
    assert.equal(written.customNote, 'keep-me');
    assert.equal(written.showFps, true);
    assert.equal(written.targetFps, 30);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('cycleSettingValue cycles booleans and choice arrays in both directions', () => {
  const boolDef = SETTING_DEFINITIONS.find((d) => d.key === 'showFps');
  assert.equal(cycleSettingValue(boolDef, false, 1), true);
  assert.equal(cycleSettingValue(boolDef, true, -1), false);

  const fpsDef = SETTING_DEFINITIONS.find((d) => d.key === 'targetFps');
  assert.equal(cycleSettingValue(fpsDef, 30, 1), 40);
  assert.equal(cycleSettingValue(fpsDef, 60, 1), 30);
  assert.equal(cycleSettingValue(fpsDef, 30, -1), 60);
});

test('setupSettingsMenu opens on M+Y, toggles showFps live, saves mkmv.json, and closes on Esc', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-menu-ui-'));
  const prevWin = global.window;
  const prevDoc = global.document;

  const { win, doc } = createMockDom();
  global.window = win;
  global.document = doc;

  try {
    const userOpt = {
      showFps: false,
      fastForward: true,
      fastForwardSpeed: 2,
      targetFps: 60,
      scaling: 'fit',
      pixelated: true,
      debugKeymap: false,
      hideCursor: false,
      disableTouch: false,
      logLevel: 'debug',
      fullscreen: true,
      performanceProfile: 'auto',
      engineVersion: 'auto',
      disableNativeGamepad: true
    };

    let fpsState = false;
    const fpsController = {
      isVisible: () => fpsState,
      setVisible: (v) => { fpsState = Boolean(v); userOpt.showFps = fpsState; return fpsState; }
    };

    const menu = setupSettingsMenu({
      userOpt,
      runtimeDir: tmpDir,
      gameRootDir: tmpDir,
      controllers: { fps: fpsController }
    });

    assert.equal(menu.isOpen(), false);

    // Hold M then press Y -> opens menu
    win.dispatch('keydown', { key: 'm', code: 'KeyM', keyCode: 77 });
    const openEv = win.dispatch('keydown', { key: 'y', code: 'KeyY', keyCode: 89 });
    assert.equal(menu.isOpen(), true);
    assert.equal(openEv.defaultPrevented, true);

    win.dispatch('keyup', { key: 'm', code: 'KeyM', keyCode: 77 });
    win.dispatch('keyup', { key: 'y', code: 'KeyY', keyCode: 89 });

    // First item is showFps -> press Enter to toggle ON
    const enterEv = win.dispatch('keydown', { key: 'Enter', code: 'Enter', keyCode: 13 });
    assert.equal(enterEv.defaultPrevented, true);
    assert.equal(fpsState, true);
    assert.equal(userOpt.showFps, true);

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'mkmv.json'), 'utf8'));
    assert.equal(saved.showFps, true);

    // Press Escape -> closes menu
    win.dispatch('keydown', { key: 'Escape', code: 'Escape', keyCode: 27 });
    assert.equal(menu.isOpen(), false);

    // Hold M (guide=m) then press Space (y=space in keymap.gptk) -> opens menu
    win.dispatch('keydown', { key: 'm', code: 'KeyM', keyCode: 77 });
    win.dispatch('keydown', { key: ' ', code: 'Space', keyCode: 32 });
    assert.equal(menu.isOpen(), true);
    win.dispatch('keyup', { key: 'm', code: 'KeyM', keyCode: 77 });
    win.dispatch('keyup', { key: ' ', code: 'Space', keyCode: 32 });

    // Close menu, then test RG VITA PRO InputPlumber M button (F1) + Y (Space)
    win.dispatch('keydown', { key: 'Escape', code: 'Escape', keyCode: 27 });
    assert.equal(menu.isOpen(), false);
    win.dispatch('keydown', { key: 'F1', code: 'F1', keyCode: 112 });
    win.dispatch('keydown', { key: ' ', code: 'Space', keyCode: 32 });
    assert.equal(menu.isOpen(), true);

    // While menu is open, triggerInput must NOT mutate window.Input._currentState
    win.Input = { _currentState: {} };
    triggerInput('down', true, 'ArrowDown', 40);
    assert.equal(win.Input._currentState.down, undefined);
  } finally {
    global.window = prevWin;
    global.document = prevDoc;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('setupFpsMeter controller can toggle FPS visibility on and off', () => {
  const prevWin = global.window;
  const prevDoc = global.document;
  const { win, doc } = createMockDom();
  win.Graphics = {
    _fpsMeter: {
      container: { style: { setProperty() {}, display: 'none' } },
      showFps() {},
      hideFps() {}
    },
    _modeBox: { style: { setProperty() {}, opacity: '0' } },
    showFps() {},
    hideFps() {}
  };
  global.window = win;
  global.document = doc;

  try {
    const opt = { showFps: false };
    const ctrl = setupFpsMeter(opt);
    assert.equal(ctrl.isVisible(), false);

    ctrl.setVisible(true);
    assert.equal(ctrl.isVisible(), true);
    assert.equal(win.Graphics._fpsMeter.container.style.display, 'block');

    ctrl.setVisible(false);
    assert.equal(ctrl.isVisible(), false);
    assert.equal(win.Graphics._fpsMeter.container.style.display, 'none');
  } finally {
    global.window = prevWin;
    global.document = prevDoc;
  }
});

test('setTargetFps dynamically switches throttling between 60 FPS and 30 FPS', () => {
  const prevWin = global.window;
  let renderCalls = 0;
  global.window = {
    Graphics: {
      frameCount: 0,
      render() {
        renderCalls++;
        this.frameCount++;
      }
    }
  };

  try {
    const opt = { targetFps: 60 };
    assert.equal(setTargetFps(opt, 60), true);
    window.Graphics.render({});
    window.Graphics.render({});
    assert.equal(renderCalls, 2);

    assert.equal(setTargetFps(opt, 30), true);
    assert.equal(opt.targetFps, 30);
  } finally {
    global.window = prevWin;
  }
});
