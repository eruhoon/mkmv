/**
 * mkmv Input: Controller Profiles, Virtual Trigger & Native Gamepad Conflict Resolver
 */

const { createLogger } = require('../logger.js');
const { waitForCondition } = require('../bootstrap.js');
const logger = createLogger('mkmv-input');

const origNativeGetGamepads = (typeof navigator !== 'undefined' && navigator.getGamepads)
  ? navigator.getGamepads.bind(navigator)
  : null;

const CONTROLLER_PROFILES = {
  retrogame_joypad: {
    name: 'Anbernic RG DS (retrogame_joypad)',
    buttons: {
      0:  { action: 'cancel',   key: 'x',          code: 88, display: 'B' },
      1:  { action: 'ok',       key: 'z',          code: 90, display: 'A' },
      2:  { action: 'shift',    key: 'Shift',      code: 16, display: 'X' },
      3:  { action: 'menu',     key: ' ',          code: 32, display: 'Y' },
      4:  { action: 'pageup',   key: 'PageUp',     code: 33, display: 'L1' },
      5:  { action: 'pagedown', key: 'PageDown',   code: 34, display: 'R1' },
      6:  { action: 'pageup',   key: 'q',          code: 81, display: 'L2' },
      7:  { action: 'pagedown', key: 'w',          code: 87, display: 'R2' },
      8:  { action: 'escape',   key: 'Escape',     code: 27, display: 'SELECT' },
      9:  { action: 'ok',       key: 'Enter',      code: 13, display: 'START' },
      10: { action: 'l3',       key: 'Control',    code: 17, display: 'L3' },
      11: { action: 'r3',       key: 'r',          code: 82, display: 'R3' },
      13: { action: 'up',       key: 'ArrowUp',    code: 38, display: 'DPAD_UP' },
      14: { action: 'down',     key: 'ArrowDown',  code: 40, display: 'DPAD_DOWN' },
      15: { action: 'left',     key: 'ArrowLeft',  code: 37, display: 'DPAD_LEFT' },
      16: { action: 'right',    key: 'ArrowRight', code: 39, display: 'DPAD_RIGHT' }
    }
  },
  standard: {
    name: 'Standard Gamepad (Xbox/Standard Layout)',
    buttons: {
      0:  { action: 'ok',       key: 'z',          code: 90, display: 'A' },
      1:  { action: 'cancel',   key: 'x',          code: 88, display: 'B' },
      2:  { action: 'shift',    key: 'Shift',      code: 16, display: 'X' },
      3:  { action: 'menu',     key: ' ',          code: 32, display: 'Y' },
      4:  { action: 'pageup',   key: 'PageUp',     code: 33, display: 'L1' },
      5:  { action: 'pagedown', key: 'PageDown',   code: 34, display: 'R1' },
      6:  { action: 'pageup',   key: 'q',          code: 81, display: 'L2' },
      7:  { action: 'pagedown', key: 'w',          code: 87, display: 'R2' },
      8:  { action: 'escape',   key: 'Escape',     code: 27, display: 'SELECT' },
      9:  { action: 'ok',       key: 'Enter',      code: 13, display: 'START' },
      10: { action: 'l3',       key: 'Control',    code: 17, display: 'L3' },
      11: { action: 'r3',       key: 'r',          code: 82, display: 'R3' },
      12: { action: 'up',       key: 'ArrowUp',    code: 38, display: 'DPAD_UP' },
      13: { action: 'down',     key: 'ArrowDown',  code: 40, display: 'DPAD_DOWN' },
      14: { action: 'left',     key: 'ArrowLeft',  code: 37, display: 'DPAD_LEFT' },
      15: { action: 'right',    key: 'ArrowRight', code: 39, display: 'DPAD_RIGHT' }
    }
  },
  nintendo: {
    name: 'Nintendo Standard Gamepad (A/B, X/Y Nintendo Layout)',
    buttons: {
      0:  { action: 'cancel',   key: 'x',          code: 88, display: 'B' },
      1:  { action: 'ok',       key: 'z',          code: 90, display: 'A' },
      2:  { action: 'menu',     key: ' ',          code: 32, display: 'Y' },
      3:  { action: 'shift',    key: 'Shift',      code: 16, display: 'X' },
      4:  { action: 'pageup',   key: 'PageUp',     code: 33, display: 'L1' },
      5:  { action: 'pagedown', key: 'PageDown',   code: 34, display: 'R1' },
      6:  { action: 'pageup',   key: 'q',          code: 81, display: 'L2' },
      7:  { action: 'pagedown', key: 'w',          code: 87, display: 'R2' },
      8:  { action: 'escape',   key: 'Escape',     code: 27, display: 'SELECT' },
      9:  { action: 'ok',       key: 'Enter',      code: 13, display: 'START' },
      10: { action: 'l3',       key: 'Control',    code: 17, display: 'L3' },
      11: { action: 'r3',       key: 'r',          code: 82, display: 'R3' },
      12: { action: 'up',       key: 'ArrowUp',    code: 38, display: 'DPAD_UP' },
      13: { action: 'down',     key: 'ArrowDown',  code: 40, display: 'DPAD_DOWN' },
      14: { action: 'left',     key: 'ArrowLeft',  code: 37, display: 'DPAD_LEFT' },
      15: { action: 'right',    key: 'ArrowRight', code: 39, display: 'DPAD_RIGHT' }
    }
  }
};

function resolveGamepadProfile(gamepad, userOpt = {}) {
  if (userOpt.gamepadProfile && CONTROLLER_PROFILES[userOpt.gamepadProfile]) {
    return CONTROLLER_PROFILES[userOpt.gamepadProfile];
  }
  const id = (gamepad && gamepad.id ? gamepad.id.toLowerCase() : '');
  if (id.includes('retrogame_joypad') || id.includes('484b') || id.includes('singleadc')) {
    return CONTROLLER_PROFILES.retrogame_joypad;
  }
  return CONTROLLER_PROFILES.standard;
}

function triggerInput(actionName, pressed, keyName, keyCode) {
  let ev = null;
  try {
    ev = new KeyboardEvent(pressed ? 'keydown' : 'keyup', {
      key: keyName,
      code: keyName,
      bubbles: true,
      cancelable: true
    });
    Object.defineProperty(ev, 'keyCode', { get: () => keyCode });
    Object.defineProperty(ev, 'which', { get: () => keyCode });
  } catch (e) {}

  const menuOpen = typeof window !== 'undefined' && Boolean(window.__mkmvSettingsMenuOpen);
  if (!menuOpen && typeof window !== 'undefined' && window.Input) {
    if (window.Input._currentState) {
      window.Input._currentState[actionName] = pressed;
      if (pressed) {
        window.Input._latestButton = actionName;
        window.Input._pressedTime = 0;
        window.Input._date = Date.now();
      }
    }
  }

  if (ev) {
    if (typeof document !== 'undefined' && document.dispatchEvent) {
      document.dispatchEvent(ev);
    } else if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(ev);
    }
  }
}

function setupNativeGamepadConflictResolver(userOpt) {
  function patchInputGamepad(inputObj) {
    if (!inputObj || inputObj._mkmvGamepadNeutralized) return;
    inputObj._mkmvGamepadNeutralized = true;

    inputObj._pollGamepads = function() {};
    if (typeof inputObj._updateGamepadState === 'function') {
      inputObj._updateGamepadState = function() {};
    }
    logger.debug('Neutralized Input._pollGamepads for conflict-free unified input');
  }

  waitForCondition(
    () => typeof window !== 'undefined' && Boolean(window.Input),
    () => patchInputGamepad(window.Input),
    { intervalMs: 10, timeoutMs: 30000 }
  );

  const disableNativeGamepad = !userOpt || userOpt.disableNativeGamepad !== false;
  if (!disableNativeGamepad) {
    const activeStates = new Map();
    let lastLoggedId = '';

    function pollHardwareGamepads() {
      if (!origNativeGetGamepads) return;
      try {
        const pads = origNativeGetGamepads();
        for (let i = 0; i < pads.length; i++) {
          const pad = pads[i];
          if (!pad || !pad.connected) continue;

          const profile = resolveGamepadProfile(pad, userOpt);
          if (pad.id !== lastLoggedId) {
            lastLoggedId = pad.id;
            logger.info(`Hardware Gamepad #${i} recognized: "${pad.id}" -> Profile: ${profile.name}`);
          }

          const buttons = Object.assign({}, profile.buttons, (userOpt && userOpt.gamepadMapping) || {});
          for (const [btnIdxStr, def] of Object.entries(buttons)) {
            const btnIdx = Number(btnIdxStr);
            const btn = pad.buttons[btnIdx];
            const isPressed = btn ? (btn.pressed || btn.value > 0.4) : false;
            const keyId = `pad_${i}_btn_${btnIdx}`;
            const wasPressed = activeStates.get(keyId) || false;

            if (isPressed && !wasPressed) {
              activeStates.set(keyId, true);
              triggerInput(def.action, true, def.key, def.code);
            } else if (!isPressed && wasPressed) {
              activeStates.set(keyId, false);
              triggerInput(def.action, false, def.key, def.code);
            }
          }

          const axX = (pad.axes && pad.axes[0]) || 0;
          const axY = (pad.axes && pad.axes[1]) || 0;
          const stickDefs = [
            { id: `pad_${i}_s_up`,    active: axY < -0.5, action: 'up',    key: 'ArrowUp',    code: 38 },
            { id: `pad_${i}_s_down`,  active: axY > 0.5,  action: 'down',  key: 'ArrowDown',  code: 40 },
            { id: `pad_${i}_s_left`,  active: axX < -0.5, action: 'left',  key: 'ArrowLeft',  code: 37 },
            { id: `pad_${i}_s_right`, active: axX > 0.5,  action: 'right', key: 'ArrowRight', code: 39 }
          ];

          for (const s of stickDefs) {
            const wasActive = activeStates.get(s.id) || false;
            if (s.active && !wasActive) {
              activeStates.set(s.id, true);
              triggerInput(s.action, true, s.key, s.code);
            } else if (!s.active && wasActive) {
              activeStates.set(s.id, false);
              triggerInput(s.action, false, s.key, s.code);
            }
          }
        }
      } catch (e) {}
    }

    function rafLoop() {
      pollHardwareGamepads();
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(rafLoop);
      }
    }
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(rafLoop);
    } else {
      const pollTimer = setInterval(pollHardwareGamepads, 16);
      if (pollTimer && pollTimer.unref) pollTimer.unref();
    }
    logger.debug('Smart Hardware Gamepad Engine installed (direct polling enabled)');
  } else {
    logger.debug('Native Gamepad polling disabled (using gptokeyb keyboard input without conflict)');
  }

  try {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      enumerable: true,
      value: function() {
        return [];
      }
    });
  } catch (e) {
    try { navigator.getGamepads = () => []; } catch (err) {}
  }

  logger.debug('Smart Hardware Gamepad Engine installed successfully (universal profile mode)');
}

function getNativeGamepads() {
  if (!origNativeGetGamepads) return [];
  try {
    return origNativeGetGamepads() || [];
  } catch (e) {
    return [];
  }
}

module.exports = {
  CONTROLLER_PROFILES,
  resolveGamepadProfile,
  triggerInput,
  setupNativeGamepadConflictResolver,
  getNativeGamepads
};
