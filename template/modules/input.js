/**
 * mkmv Input & Key Handling Module
 *
 * 기능:
 * 1. 시스템 단축키 가드 (전체화면 F4, 새로고침 F5, Ctrl+R 차단)
 * 2. 터치 입력 차단 옵션 (disableTouch: true)
 * 3. PortMaster gptokeyb 게임패드 충돌 방지 및 Web Gamepad API 격리 (input/gamepad.js)
 * 4. 키매핑 실시간 디버그 오버레이 (input/keymap-overlay.js)
 * 5. 고속 배속(Fast-Forward / 터보) 시스템 (input/fast-forward.js)
 * 6. 1프레임 미만 짧은 키 탭(연타) 유실 방지 래치 (patchInputLatch)
 */

const { createLogger } = require('./logger.js');
const { waitForCondition } = require('./bootstrap.js');
const {
  CONTROLLER_PROFILES,
  resolveGamepadProfile,
  triggerInput,
  setupNativeGamepadConflictResolver,
  getNativeGamepads
} = require('./input/gamepad.js');
const { setupKeymapDebugOverlay } = require('./input/keymap-overlay.js');
const { setupFastForward } = require('./input/fast-forward.js');

const logger = createLogger('mkmv-input');

function setupKeyGuards() {
  window.addEventListener('keydown', (e) => {
    const key = e.key ? e.key.toUpperCase() : '';
    if (key === 'F4' || key === 'F5' || (e.ctrlKey && key === 'R')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

function setupTouchControls(userOpt) {
  if (typeof window === 'undefined') return;

  const cancelTouch = (e) => {
    if (!userOpt || !userOpt.disableTouch) return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('touchstart', cancelTouch, { capture: true, passive: false });
  window.addEventListener('touchmove', cancelTouch, { capture: true, passive: false });
  window.addEventListener('touchend', cancelTouch, { capture: true, passive: false });
  window.addEventListener('touchcancel', cancelTouch, { capture: true, passive: false });

  if (userOpt && userOpt.disableTouch) {
    waitForCondition(
      () => Boolean(window.TouchInput),
      () => { window.TouchInput._setupEventHandlers = function() {}; },
      { intervalMs: 30, timeoutMs: 10000 }
    );
    logger.debug('Touch input disabled via config');
  }
}

function patchInputLatch(inputObj) {
  if (!inputObj || inputObj._mkmvLatchPatched) return false;
  if (typeof inputObj._onKeyDown !== 'function' || typeof inputObj._onKeyUp !== 'function' || typeof inputObj.update !== 'function') {
    return false;
  }
  inputObj._mkmvLatchPatched = true;

  const unconsumed = new Set();
  const deferredUp = new Set();

  const origOnKeyDown = inputObj._onKeyDown;
  const origOnKeyUp = inputObj._onKeyUp;
  const origUpdate = inputObj.update;
  const origClear = inputObj.clear;

  inputObj._onKeyDown = function(event) {
    const buttonName = this.keyMapper && event ? this.keyMapper[event.keyCode] : null;
    if (buttonName) {
      unconsumed.add(buttonName);
      deferredUp.delete(buttonName);
    }
    return origOnKeyDown.apply(this, arguments);
  };

  inputObj._onKeyUp = function(event) {
    const buttonName = this.keyMapper && event ? this.keyMapper[event.keyCode] : null;
    if (buttonName && unconsumed.has(buttonName)) {
      deferredUp.add(buttonName);
      return;
    }
    return origOnKeyUp.apply(this, arguments);
  };

  inputObj.update = function() {
    const res = origUpdate.apply(this, arguments);
    unconsumed.clear();
    if (deferredUp.size > 0) {
      if (this._currentState) {
        for (const buttonName of deferredUp) {
          this._currentState[buttonName] = false;
        }
      }
      deferredUp.clear();
    }
    return res;
  };

  if (typeof origClear === 'function') {
    inputObj.clear = function() {
      unconsumed.clear();
      deferredUp.clear();
      return origClear.apply(this, arguments);
    };
  }
  return true;
}

function setupInputLatch() {
  if (typeof window === 'undefined') return;
  if (window.Input && patchInputLatch(window.Input)) return;

  waitForCondition(
    () => Boolean(window.Input && patchInputLatch(window.Input)),
    () => { logger.debug('1-frame input latch installed on window.Input'); },
    { intervalMs: 15, timeoutMs: 30000, runImmediately: false }
  );
}

function setupInputModule(options = {}) {
  const { userOpt = {}, isMZ = false } = options;
  setupKeyGuards();
  setupTouchControls(userOpt);
  setupNativeGamepadConflictResolver(userOpt);
  setupInputLatch();
  const keymap = setupKeymapDebugOverlay(userOpt, getNativeGamepads);
  const fastForward = setupFastForward(userOpt, isMZ);
  return { keymap, fastForward };
}

module.exports = {
  setupInputModule,
  CONTROLLER_PROFILES,
  resolveGamepadProfile,
  triggerInput,
  patchInputLatch,
  getNativeGamepads
};
