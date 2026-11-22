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
