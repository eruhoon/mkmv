/**
 * mkmv Input & Key Handling Module
 *
 * 기능:
 * 1. 시스템 단축키 가드 (전체화면 F4, 새로고침 F5, Ctrl+R 차단)
 * 2. 터치 입력 차단 옵션 (disableTouch: true)
 * 3. PortMaster gptokeyb 게임패드 충돌 방지 및 Web Gamepad API 격리
 * 4. 키매핑 실시간 디버그 오버레이 (F10 토글 / debugKeymap: true)
 * 5. 고속 배속(Fast-Forward / 터보) 시스템 (R3 / R / Tab 키 토글 및 발열 방지 프레임 스킵)
 */

const { createLogger } = require('./logger.js');
const logger = createLogger('mkmv-input');

let origNativeGetGamepads = (typeof navigator !== 'undefined' && navigator.getGamepads)
  ? navigator.getGamepads.bind(navigator)
  : null;

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
  if (!userOpt || !userOpt.disableTouch) return;

  const cancelTouch = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('touchstart', cancelTouch, { capture: true, passive: false });
  window.addEventListener('touchmove', cancelTouch, { capture: true, passive: false });
  window.addEventListener('touchend', cancelTouch, { capture: true, passive: false });
  window.addEventListener('touchcancel', cancelTouch, { capture: true, passive: false });

  const touchTimer = setInterval(() => {
    if (window.TouchInput) {
      window.TouchInput._setupEventHandlers = function() {};
      clearInterval(touchTimer);
    }
  }, 30);
  setTimeout(() => clearInterval(touchTimer), 10000);
  logger.debug('Touch input disabled via config');
}

// ==============================================================================
// 컨트롤러 기기별 프로필 정의 (Anbernic RG DS, Standard W3C Xbox/PS 등)
// ==============================================================================
const CONTROLLER_PROFILES = {
  // Anbernic RG DS (Single ADC Joypad, ROCKNIX / AmberELEC 등 리눅스 임베디드 기기)
  retrogame_joypad: {
    name: 'Anbernic RG DS (retrogame_joypad)',
    buttons: {
      0:  { action: 'cancel', key: 'x',          code: 88, display: 'B' },
      1:  { action: 'ok',     key: 'z',          code: 90, display: 'A' },
      2:  { action: 'shift',  key: 'Shift',      code: 16, display: 'X' },
      3:  { action: 'menu',   key: ' ',          code: 32, display: 'Y' },
      4:  { action: 'pageup', key: 'PageUp',     code: 33, display: 'L1' },
      5:  { action: 'pagedown',key: 'PageDown',  code: 34, display: 'R1' },
      6:  { action: 'pageup', key: 'q',          code: 81, display: 'L2' },
      7:  { action: 'pagedown',key: 'w',         code: 87, display: 'R2' },
      8:  { action: 'escape', key: 'Escape',     code: 27, display: 'SELECT' },
      9:  { action: 'ok',     key: 'Enter',      code: 13, display: 'START' },
      13: { action: 'up',     key: 'ArrowUp',    code: 38, display: 'DPAD_UP' },
      14: { action: 'down',   key: 'ArrowDown',  code: 40, display: 'DPAD_DOWN' },
      15: { action: 'left',   key: 'ArrowLeft',  code: 37, display: 'DPAD_LEFT' },
      16: { action: 'right',  key: 'ArrowRight', code: 39, display: 'DPAD_RIGHT' }
    }
  },
  // 표준 W3C Gamepad 레이아웃 (Xbox 360 / RG VITA PRO / 일반 USB 패드 등)
  standard: {
    name: 'Standard Gamepad (Xbox/Standard Layout)',
    buttons: {
      0:  { action: 'ok',     key: 'z',          code: 90, display: 'A' },
      1:  { action: 'cancel', key: 'x',          code: 88, display: 'B' },
      2:  { action: 'shift',  key: 'Shift',      code: 16, display: 'X' },
      3:  { action: 'menu',   key: ' ',          code: 32, display: 'Y' },
      4:  { action: 'pageup', key: 'PageUp',     code: 33, display: 'L1' },
      5:  { action: 'pagedown',key: 'PageDown',  code: 34, display: 'R1' },
      6:  { action: 'pageup', key: 'q',          code: 81, display: 'L2' },
      7:  { action: 'pagedown',key: 'w',         code: 87, display: 'R2' },
      8:  { action: 'escape', key: 'Escape',     code: 27, display: 'SELECT' },
      9:  { action: 'ok',     key: 'Enter',      code: 13, display: 'START' },
      12: { action: 'up',     key: 'ArrowUp',    code: 38, display: 'DPAD_UP' },
      13: { action: 'down',   key: 'ArrowDown',  code: 40, display: 'DPAD_DOWN' },
      14: { action: 'left',   key: 'ArrowLeft',  code: 37, display: 'DPAD_LEFT' },
      15: { action: 'right',  key: 'ArrowRight', code: 39, display: 'DPAD_RIGHT' }
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

// 가상 키보드 이벤트 생성 및 알만툴 Input 엔진 직접 주입
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

  // 알만툴 MV / MZ 내장 Input 엔진 상태 1:1 동기화
  if (typeof window !== 'undefined' && window.Input) {
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
    }
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(ev);
    }
  }
}

function setupNativeGamepadConflictResolver(userOpt) {
  // 알만툴 MV / MZ 내장 Input 게임패드 폴러 무력화 (기기별 오동작 방지)
  function patchInputGamepad(inputObj) {
    if (!inputObj || inputObj._mkmvGamepadNeutralized) return;
    inputObj._mkmvGamepadNeutralized = true;

    inputObj._pollGamepads = function() {};
    if (typeof inputObj._updateGamepadState === 'function') {
      inputObj._updateGamepadState = function() {};
    }
    logger.debug('Neutralized Input._pollGamepads for conflict-free unified input');
  }

  const inputTimer = setInterval(() => {
    if (typeof window !== 'undefined' && window.Input) {
      patchInputGamepad(window.Input);
      clearInterval(inputTimer);
    }
  }, 10);
  setTimeout(() => clearInterval(inputTimer), 30000);

  // 스마트 하드웨어 게임패드 엔진 (Wayland/Sway 가상키보드 격리 및 D-Pad 번호 파편화 극복)
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

        // 1. 버튼 검사
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

        // 2. 아날로그 스틱 검사 (데드존 0.5)
        const axX = (pad.axes && pad.axes[0]) || 0;
        const axY = (pad.axes && pad.axes[1]) || 0;
        const sUp = axY < -0.5;
        const sDown = axY > 0.5;
        const sLeft = axX < -0.5;
        const sRight = axX > 0.5;

        const stickDefs = [
          { id: `pad_${i}_s_up`,    active: sUp,    action: 'up',    key: 'ArrowUp',   code: 38 },
          { id: `pad_${i}_s_down`,  active: sDown,  action: 'down',  key: 'ArrowDown', code: 40 },
          { id: `pad_${i}_s_left`,  active: sLeft,  action: 'left',  key: 'ArrowLeft', code: 37 },
          { id: `pad_${i}_s_right`, active: sRight, action: 'right', key: 'ArrowRight',code: 39 }
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

  // 폴링 루프 가동 (requestAnimationFrame 기반 고주사율 폴링 + setInterval 백업)
  let pollRunning = true;
  function rafLoop() {
    if (!pollRunning) return;
    pollHardwareGamepads();
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(rafLoop);
    }
  }
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(rafLoop);
  } else {
    setInterval(pollHardwareGamepads, 16);
  }

  // 외부 게임 스크립트/플러그인 충돌 방지를 위한 Web Gamepad API 반환 격리
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

function setupKeymapDebugOverlay(userOpt) {
  let isVisible = !!(userOpt && userOpt.debugKeymap);
  let overlay = null;

  const defaultKeyMapper = {
    9: 'tab',
    13: 'ok',
    16: 'shift',
    17: 'control',
    18: 'control',
    27: 'escape',
    32: 'ok',
    33: 'pageup',
    34: 'pagedown',
    37: 'left',
    38: 'up',
    39: 'right',
    40: 'down',
    45: 'escape',
    81: 'pageup',
    87: 'pagedown',
    88: 'escape',
    90: 'ok',
    96: 'escape',
    98: 'down',
    100: 'left',
    102: 'right',
    104: 'up',
    120: 'debug'
  };

  function getRpgAction(keyCode) {
    if (window.Input && window.Input.keyMapper && window.Input.keyMapper[keyCode]) {
      return window.Input.keyMapper[keyCode];
    }
    return defaultKeyMapper[keyCode] || null;
  }

  const activeKeys = new Map();
  const history = [];
  const MAX_HISTORY = 6;

  function render() {
    if (!overlay || !isVisible) return;

    let html = '<div style="font-weight:bold; color:#00e5ff; font-size:13px; margin-bottom:4px; border-bottom:1px solid rgba(0,229,255,0.4); padding-bottom:3px; display:flex; justify-content:space-between;">' +
               '<span>🎮 KEYMAP DEBUG</span><span style="color:#aaa; font-size:10px; margin-left:10px;">[F10 Toggle]</span></div>';

    // 현재 누르고 있는 키 상태
    const activeArr = Array.from(activeKeys.values());
    if (activeArr.length > 0) {
      const badges = activeArr.map(item => {
        const act = item.action ? `:${item.action}` : '';
        return `<span style="background:#00e5ff; color:#05101a; padding:1px 5px; border-radius:3px; font-weight:bold; margin-right:3px; font-size:11px;">${item.display}${act}</span>`;
      }).join(' ');
      html += `<div style="margin-bottom:5px; font-size:11px;"><span style="color:#aaa;">HOLDING:</span> ${badges}</div>`;
    } else {
      html += '<div style="margin-bottom:5px; font-size:11px; color:#888;">HOLDING: <span style="color:#666;">(none)</span></div>';
    }

    // 최근 키 입력 로그 (최신순)
    html += '<div style="font-size:11px; display:flex; flex-direction:column; gap:2px;">';
    if (history.length === 0) {
      html += '<div style="color:#777; font-style:italic;">Waiting for gamepad button / key...</div>';
    } else {
      for (const item of history) {
        const isDown = item.type === 'DOWN';
        const typeColor = isDown ? '#00ff66' : '#ffaa00';
        const actionStr = item.action
          ? `<span style="color:#00e5ff; font-weight:bold;">➡ "${item.action}"</span>`
          : '<span style="color:#777;">➡ (none)</span>';
        html += `<div><span style="color:${typeColor}; font-weight:bold;">[${item.type}]</span> <span style="color:#ffffff; font-weight:bold;">${item.key}</span> <span style="color:#888;">(code: ${item.code}, which: ${item.keyCode})</span> ${actionStr}</div>`;
      }
    }
    html += '</div>';

    overlay.innerHTML = html;
  }

  function ensureOverlay() {
    if (!document.body) return null;

    let isNew = false;
    if (!overlay) {
      overlay = document.getElementById('mkmv-keymap-debug');
    }
    if (!overlay) {
      isNew = true;
      overlay = document.createElement('div');
      overlay.id = 'mkmv-keymap-debug';
      overlay.style.setProperty('position', 'absolute', 'important');
      overlay.style.setProperty('top', (userOpt && userOpt.showFps) ? '45px' : '15px', 'important');
      overlay.style.setProperty('left', '15px', 'important');
      overlay.style.setProperty('z-index', '2147483647', 'important');
      overlay.style.setProperty('background-color', '#0b132b', 'important');
      overlay.style.setProperty('color', '#ffffff', 'important');
      overlay.style.setProperty('font-family', 'monospace, "Courier New", sans-serif', 'important');
      overlay.style.setProperty('font-size', '13px', 'important');
      overlay.style.setProperty('line-height', '1.4', 'important');
      overlay.style.setProperty('padding', '8px 14px', 'important');
      overlay.style.setProperty('border-radius', '6px', 'important');
      overlay.style.setProperty('border', '3px solid #00ffff', 'important');
      overlay.style.setProperty('box-shadow', '0 0 20px rgba(0, 255, 255, 0.8)', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
      overlay.style.setProperty('user-select', 'none', 'important');
      overlay.style.setProperty('min-width', '280px', 'important');
      overlay.style.setProperty('max-width', '450px', 'important');
      overlay.style.setProperty('visibility', 'visible', 'important');
      overlay.style.setProperty('opacity', '1', 'important');
      overlay.style.setProperty('transform', 'translateZ(9999px)', 'important');
      overlay.style.setProperty('will-change', 'transform', 'important');
    }

    overlay.style.setProperty('display', isVisible ? 'block' : 'none', 'important');
    if (overlay.parentNode !== document.body || document.body.lastElementChild !== overlay) {
      document.body.appendChild(overlay);
      if (isNew) {
        logger.debug('Keymap debug overlay attached to document.body (z-index: 2147483647)');
      }
    }
    render();
    return overlay;
  }

  ensureOverlay();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ensureOverlay());
  }

  // 화면 전환 시 최상단(lastChild) 유지
  setInterval(() => {
    ensureOverlay();
  }, 150);

  function recordKey(type, e) {
    const key = e.key || e.code || 'Unknown';
    const code = e.code || '-';
    const keyCode = e.keyCode || e.which || 0;
    const action = getRpgAction(keyCode);

    logger.verbose(`${type}: key="${key}", code="${code}", keyCode=${keyCode} -> RPG: "${action || 'none'}"`);

    const keyId = `${code}_${keyCode}`;
    if (type === 'DOWN') {
      activeKeys.set(keyId, { display: key, code, keyCode, action });
    } else {
      activeKeys.delete(keyId);
    }

    history.unshift({
      type,
      key,
      code,
      keyCode,
      action,
      time: Date.now()
    });
    if (history.length > MAX_HISTORY) {
      history.pop();
    }

    ensureOverlay();
  }

  // 물리 패드 하드웨어 상태 감시 (디버그 시 활성화)
  let lastPadState = '';
  setInterval(() => {
    if (!isVisible || !origNativeGetGamepads) return;
    try {
      const pads = origNativeGetGamepads();
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (!pad) continue;
        const pressed = [];
        for (let b = 0; b < pad.buttons.length; b++) {
          if (pad.buttons[b].pressed || pad.buttons[b].value > 0.5) {
            pressed.push(b);
          }
        }
        if (pressed.length > 0) {
          const stateStr = `pad${i}_btn[${pressed.join(',')}]`;
          if (stateStr !== lastPadState) {
            lastPadState = stateStr;
            logger.verbose(`Hardware Gamepad #${i} (${pad.id}): Pressed buttons: ${pressed.join(', ')}`);
          }
        }
      }
    } catch (e) {}
  }, 100);

  const handleKeydown = (e) => {
    if (e._mkmvHandled) return;
    e._mkmvHandled = true;
    const key = e.key ? e.key.toUpperCase() : '';
    if (key === 'F10' || e.code === 'F10' || e.keyCode === 121) {
      isVisible = !isVisible;
      const el = ensureOverlay();
      if (el) {
        el.style.setProperty('display', isVisible ? 'block' : 'none', 'important');
        if (isVisible) render();
      }
      logger.debug(`Keymap debug overlay visibility toggled: ${isVisible}`);
      e.preventDefault();
      return;
    }
    recordKey('DOWN', e);
  };

  const handleKeyup = (e) => {
    if (e._mkmvHandled) return;
    e._mkmvHandled = true;
    const key = e.key ? e.key.toUpperCase() : '';
    if (key === 'F10' || e.code === 'F10' || e.keyCode === 121) {
      e.preventDefault();
      return;
    }
    recordKey('UP', e);
  };

  window.addEventListener('keydown', handleKeydown, { capture: true, passive: false });
  window.addEventListener('keyup', handleKeyup, { capture: true, passive: false });

  if (isVisible) {
    logger.debug('Keymap debug overlay enabled (debugKeymap: true)');
    ensureOverlay();
  }
}

function setupFastForward(userOpt, isMZ) {
  if (userOpt && userOpt.fastForward === false) return;

  const speedMultiplier = Math.max(1, Number(userOpt && userOpt.fastForwardSpeed) || 2);
  let isFastForward = false;
  let indicator = null;

  function ensureIndicator() {
    if (!indicator) {
      indicator = document.getElementById('mkmv-fast-forward');
    }
    if (!indicator) {
      if (!document.body) return null;
      indicator = document.createElement('div');
      indicator.id = 'mkmv-fast-forward';
      indicator.style.setProperty('display', 'none', 'important');
      indicator.style.setProperty('position', 'fixed', 'important');
      indicator.style.setProperty('top', '10px', 'important');
      indicator.style.setProperty('right', '12px', 'important');
      indicator.style.setProperty('z-index', '2147483647', 'important');
      indicator.style.setProperty('background-color', 'rgba(0, 0, 0, 0.75)', 'important');
      indicator.style.setProperty('color', '#00e5ff', 'important');
      indicator.style.setProperty('font-family', 'monospace, sans-serif', 'important');
      indicator.style.setProperty('font-size', '14px', 'important');
      indicator.style.setProperty('font-weight', 'bold', 'important');
      indicator.style.setProperty('padding', '3px 8px', 'important');
      indicator.style.setProperty('border-radius', '4px', 'important');
      indicator.style.setProperty('border', '1px solid rgba(0, 229, 255, 0.6)', 'important');
      indicator.style.setProperty('box-shadow', '0 0 8px rgba(0, 229, 255, 0.4)', 'important');
      indicator.style.setProperty('pointer-events', 'none', 'important');
      indicator.style.setProperty('user-select', 'none', 'important');
      indicator.textContent = `▶▶ ${speedMultiplier}x`;
      document.body.appendChild(indicator);
    }
    return indicator;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ensureIndicator());
  } else {
    ensureIndicator();
  }

  function toggleFastForward() {
    isFastForward = !isFastForward;
    const badge = ensureIndicator();
    if (badge) {
      badge.style.setProperty('display', isFastForward ? 'block' : 'none', 'important');
      if (isFastForward) {
        if (badge.style.zIndex !== '2147483647') {
          badge.style.setProperty('z-index', '2147483647', 'important');
        }
        if (document.body && badge.parentNode !== document.body) {
          document.body.appendChild(badge);
        }
      }
    }
    logger.debug(`Fast forward toggled: ${isFastForward ? `${speedMultiplier}x` : '1x'}`);
  }

  window.addEventListener('keydown', (e) => {
    const key = e.key ? e.key.toUpperCase() : '';
    const isR = key === 'R' || e.code === 'KeyR' || e.keyCode === 82;
    const isTab = key === 'TAB' || e.code === 'Tab' || e.keyCode === 9;
    if ((isR || isTab) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      toggleFastForward();
    }
  }, true);

  let renderSkipCounter = 0;

  const hookTimer = setInterval(() => {
    if (window.SceneManager && window.SceneManager.updateMain) {
      const origUpdateMain = window.SceneManager.updateMain;
      window.SceneManager.updateMain = function() {
        if (!isFastForward) {
          return origUpdateMain.apply(this, arguments);
        }

        if (isMZ || typeof this._deltaTime === 'undefined') {
          for (let i = 0; i < speedMultiplier; i++) {
            if (typeof this.updateFrameCount === 'function') this.updateFrameCount();
            if (typeof this.updateInputData === 'function') this.updateInputData();
            if (typeof this.updateEffekseer === 'function') this.updateEffekseer();
            if (typeof this.changeScene === 'function') this.changeScene();
            if (typeof this.updateScene === 'function') this.updateScene();
          }
          return;
        } else if (typeof Utils !== 'undefined' && Utils.isMobileSafari && Utils.isMobileSafari()) {
          for (let i = 0; i < speedMultiplier; i++) {
            this.changeScene();
            this.updateScene();
          }
        } else {
          const newTime = this._getTimeInMsWithoutMobileSafari ? this._getTimeInMsWithoutMobileSafari() : performance.now();
          let fTime = (newTime - this._currentTime) / 1000;
          if (fTime > 0.15) fTime = 0.15;
          this._currentTime = newTime;
          this._accumulator += fTime * speedMultiplier;

          let loops = 0;
          const maxLoops = Math.min(speedMultiplier * 2, 4);
          while (this._accumulator >= this._deltaTime && loops < maxLoops) {
            this.updateInputData();
            this.changeScene();
            this.updateScene();
            this._accumulator -= this._deltaTime;
            loops++;
          }
          if (this._accumulator > this._deltaTime) {
            this._accumulator = 0;
          }
        }

        // MV 전용 프레임 스킵 (발열 절감)
        renderSkipCounter = (renderSkipCounter + 1) % 2;
        if (renderSkipCounter === 0 && typeof this.renderScene === 'function') {
          this.renderScene();
        }

        if (typeof this.requestUpdate === 'function') {
          this.requestUpdate();
        }
      };
      clearInterval(hookTimer);
      logger.debug(`Fast forward engine hook installed (${speedMultiplier}x available on R3/Tab with thermal frame-skip)`);
    }
  }, 50);
  setTimeout(() => clearInterval(hookTimer), 30000);
}

function setupInputModule(options = {}) {
  const { userOpt = {}, isMZ = false } = options;
  setupKeyGuards();
  setupTouchControls(userOpt);
  setupNativeGamepadConflictResolver(userOpt);
  setupKeymapDebugOverlay(userOpt);
  setupFastForward(userOpt, isMZ);
}

module.exports = {
  setupInputModule,
  CONTROLLER_PROFILES,
  resolveGamepadProfile,
  triggerInput
};
