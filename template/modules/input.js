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
  console.log('[mkmv-input] Touch input disabled via config');
}

function setupNativeGamepadConflictResolver(userOpt) {
  if (userOpt && userOpt.disableNativeGamepad === false) {
    console.log('[mkmv-input] Native Gamepad API active (disableNativeGamepad: false)');
    return;
  }

  // 1. Web Gamepad API 격리 (게임 엔진 및 외부 플러그인에 빈 게임패드 목록 반환)
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

  // 2. 알만툴 MV / MZ 내장 Input 게임패드 폴러 무력화
  function patchInputGamepad(inputObj) {
    if (!inputObj || inputObj._mkmvGamepadNeutralized) return;
    inputObj._mkmvGamepadNeutralized = true;

    inputObj._pollGamepads = function() {
      // gptokeyb와의 이중 입력 및 _latestButton 덮어쓰기 방지 (no-op)
    };
    if (typeof inputObj._updateGamepadState === 'function') {
      inputObj._updateGamepadState = function() {};
    }
    console.log('[mkmv-input] Neutralized Input._pollGamepads for gptokeyb harmony');
  }

  let inputHooked = false;
  const inputTimer = setInterval(() => {
    if (window.Input) {
      patchInputGamepad(window.Input);
      inputHooked = true;
      clearInterval(inputTimer);
    }
  }, 10);
  setTimeout(() => clearInterval(inputTimer), 30000);

  console.log('[mkmv-input] Native Gamepad API isolated successfully (gptokeyb single-source mode)');
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
        console.log('[mkmv-input] Keymap debug overlay attached to document.body (z-index: 2147483647)');
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

    console.log(`[mkmv-input] ${type}: key="${key}", code="${code}", keyCode=${keyCode} -> RPG: "${action || 'none'}"`);

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
            console.log(`[mkmv-input] Hardware Gamepad #${i} (${pad.id}): Pressed buttons: ${pressed.join(', ')}`);
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
      console.log(`[mkmv-input] Keymap debug overlay visibility toggled: ${isVisible}`);
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
    console.log('[mkmv-input] Keymap debug overlay enabled (debugKeymap: true)');
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
    console.log(`[mkmv-input] Fast forward toggled: ${isFastForward ? `${speedMultiplier}x` : '1x'}`);
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
      console.log(`[mkmv-input] Fast forward engine hook installed (${speedMultiplier}x available on R3/Tab with thermal frame-skip)`);
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
  setupInputModule
};
