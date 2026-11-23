const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  CONTROLLER_PROFILES,
  resolveGamepadProfile,
  triggerInput,
  patchInputLatch
} = require(path.join(__dirname, '..', '..', 'template', 'modules', 'input.js'));

test('resolveGamepadProfile identifies controller type correctly', () => {
  // 1. Anbernic RG DS / singleadc joypad
  const rgdsPad = { id: 'retrogame_joypad (Vendor: 484b Product: 1101)' };
  assert.equal(resolveGamepadProfile(rgdsPad).name, CONTROLLER_PROFILES.retrogame_joypad.name);

  // 2. Standard Xbox / PS / PC controller
  const standardPad = { id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)' };
  assert.equal(resolveGamepadProfile(standardPad).name, CONTROLLER_PROFILES.standard.name);

  // 3. User override in userOpt
  assert.equal(
    resolveGamepadProfile(standardPad, { gamepadProfile: 'retrogame_joypad' }).name,
    CONTROLLER_PROFILES.retrogame_joypad.name
  );

  // 4. Nintendo W3C standard profile override
  const nintendoProfile = resolveGamepadProfile(standardPad, { gamepadProfile: 'nintendo' });
  assert.equal(nintendoProfile.name, CONTROLLER_PROFILES.nintendo.name);
  assert.equal(nintendoProfile.buttons[0].action, 'cancel'); // B (South)
  assert.equal(nintendoProfile.buttons[1].action, 'ok');     // A (East)
  assert.equal(nintendoProfile.buttons[2].action, 'menu');   // Y (West)
  assert.equal(nintendoProfile.buttons[3].action, 'shift');  // X (North)
  assert.equal(nintendoProfile.buttons[12].action, 'up');    // W3C D-Pad Up
});

test('CONTROLLER_PROFILES mapping definitions are correct', () => {
  // Anbernic RG DS hardware button indices
  const rgds = CONTROLLER_PROFILES.retrogame_joypad.buttons;
  assert.equal(rgds[13].action, 'up');
  assert.equal(rgds[14].action, 'down');
  assert.equal(rgds[15].action, 'left');
  assert.equal(rgds[16].action, 'right');
  assert.equal(rgds[1].action, 'ok');     // A (East)
  assert.equal(rgds[0].action, 'cancel'); // B (South)
  assert.equal(rgds[2].action, 'shift');  // X (North)
  assert.equal(rgds[3].action, 'menu');   // Y (West)
  assert.equal(rgds[8].action, 'escape'); // Select
  assert.equal(rgds[9].action, 'ok');     // Start
  assert.equal(rgds[11].action, 'r3');    // R3 (Fast Forward)
  assert.equal(rgds[11].key, 'r');

  // Standard Gamepad indices
  const std = CONTROLLER_PROFILES.standard.buttons;
  assert.equal(std[10].action, 'l3');
  assert.equal(std[11].action, 'r3');    // R3 (Fast Forward)
  assert.equal(std[11].key, 'r');
  assert.equal(std[12].action, 'up');
  assert.equal(std[13].action, 'down');
  assert.equal(std[14].action, 'left');
  assert.equal(std[15].action, 'right');
});

test('triggerInput updates window.Input and dispatches keyboard events', () => {
  global.window = {
    Input: {
      _currentState: {},
      _latestButton: null,
      _pressedTime: 0,
      _date: 0
    },
    dispatchEvent: () => {}
  };
  global.document = {
    dispatchEvent: () => {}
  };

  triggerInput('up', true, 'ArrowUp', 38);
  assert.equal(global.window.Input._currentState['up'], true);
  assert.equal(global.window.Input._latestButton, 'up');

  triggerInput('up', false, 'ArrowUp', 38);
  assert.equal(global.window.Input._currentState['up'], false);

  delete global.window;
  delete global.document;
});

test('patchInputLatch preserves sub-frame key taps until Input.update consumes them', () => {
  const seenPressed = [];
  const mockInput = {
    keyMapper: { 90: 'ok', 88: 'cancel' },
    _currentState: {},
    _onKeyDown(ev) {
      const name = this.keyMapper[ev.keyCode];
      if (name) this._currentState[name] = true;
    },
    _onKeyUp(ev) {
      const name = this.keyMapper[ev.keyCode];
      if (name) this._currentState[name] = false;
    },
    update() {
      seenPressed.push(Boolean(this._currentState.ok));
    },
    clear() {
      this._currentState = {};
    }
  };

  assert.equal(patchInputLatch(mockInput), true);

  // Sub-frame tap: keydown + keyup before Input.update()
  mockInput._onKeyDown({ keyCode: 90 });
  mockInput._onKeyUp({ keyCode: 90 });

  // First update must still observe 'ok' as pressed!
  mockInput.update();
  assert.deepEqual(seenPressed, [true]);

  // After update consumes it, 'ok' is released for the next frame
  mockInput.update();
  assert.deepEqual(seenPressed, [true, false]);
});


test('setupFastForward toggles on R/Tab and accelerates SceneManager.updateMain', () => {
  const { setupFastForward } = require('../../template/modules/input/fast-forward.js');
  const origWindow = global.window;
  const origDocument = global.document;

  const listeners = new Map();
  let updateCount = 0;

  try {
    global.document = {
      readyState: 'complete',
      body: {
        appendChild(el) { el.parentNode = this; }
      },
      getElementById: () => null,
      createElement: () => ({
        id: '',
        parentNode: null,
        textContent: '',
        style: { setProperty() {} }
      })
    };
    global.window = {
      SceneManager: {
        updateMain() { updateCount++; },
        updateFrameCount() { updateCount++; },
        updateInputData() {},
        changeScene() {},
        updateScene() {}
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      }
    };

    const userOpt = { fastForward: true, fastForwardSpeed: 3 };
    const ff = setupFastForward(userOpt, true);
    assert.equal(ff.isActive(), false);

    // Normal mode: calls original updateMain once
    global.window.SceneManager.updateMain();
    assert.equal(updateCount, 1);

    // Press R to toggle fast-forward ON
    for (const fn of listeners.get('keydown') || []) {
      fn({ key: 'r', code: 'KeyR', keyCode: 82, preventDefault() {} });
    }
    assert.equal(ff.isActive(), true);

    updateCount = 0;
    global.window.SceneManager.updateMain();
    assert.equal(updateCount, 3);

    // Disabling via config + refresh turns fast-forward off
    userOpt.fastForward = false;
    ff.refresh();
    assert.equal(ff.isActive(), false);
  } finally {
    global.window = origWindow;
    global.document = origDocument;
  }
});

test('setupKeymapDebugOverlay toggles visibility on F10 and setVisible', () => {
  const { setupKeymapDebugOverlay } = require('../../template/modules/input/keymap-overlay.js');
  const origWindow = global.window;
  const origDocument = global.document;

  const listeners = new Map();
  const elements = new Map();

  try {
    global.document = {
      readyState: 'complete',
      body: {
        lastElementChild: null,
        appendChild(el) {
          el.parentNode = this;
          this.lastElementChild = el;
          if (el.id) elements.set(el.id, el);
        }
      },
      getElementById: (id) => elements.get(id) || null,
      createElement: () => ({
        id: '',
        innerHTML: '',
        parentNode: null,
        style: {
          _props: {},
          setProperty(k, v) { this._props[k] = v; }
        }
      })
    };
    global.window = {
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      }
    };

    const userOpt = { debugKeymap: false };
    const ctrl = setupKeymapDebugOverlay(userOpt, () => []);
    assert.equal(ctrl.isVisible(), false);

    for (const fn of listeners.get('keydown') || []) {
      fn({ key: 'F10', code: 'F10', keyCode: 121, preventDefault() {} });
    }
    assert.equal(ctrl.isVisible(), true);
    assert.equal(elements.get('mkmv-keymap-debug').style._props.display, 'block');

    ctrl.setVisible(false);
    assert.equal(ctrl.isVisible(), false);
    assert.equal(userOpt.debugKeymap, false);
    assert.equal(elements.get('mkmv-keymap-debug').style._props.display, 'none');
  } finally {
    global.window = origWindow;
    global.document = origDocument;
  }
});
