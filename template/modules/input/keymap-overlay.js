/**
 * mkmv Input: Real-time Keymap Debug Overlay (F10 Toggle)
 */

const { createLogger } = require('../logger.js');
const logger = createLogger('mkmv-input');

function setupKeymapDebugOverlay(userOpt, getNativeGamepadsFn) {
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

    overlay.style.setProperty('top', (userOpt && userOpt.showFps) ? '45px' : '15px', 'important');
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

  const overlayTimer = setInterval(() => {
    if (isVisible) ensureOverlay();
  }, 150);
  if (overlayTimer && overlayTimer.unref) overlayTimer.unref();

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

  let lastPadState = '';
  const padDebugTimer = setInterval(() => {
    if (!isVisible || typeof getNativeGamepadsFn !== 'function') return;
    try {
      const pads = getNativeGamepadsFn();
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
  if (padDebugTimer && padDebugTimer.unref) padDebugTimer.unref();

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

  return {
    isVisible: () => isVisible,
    setVisible: (nextVisible) => {
      isVisible = Boolean(nextVisible);
      if (userOpt) userOpt.debugKeymap = isVisible;
      const el = ensureOverlay();
      if (el) {
        el.style.setProperty('display', isVisible ? 'block' : 'none', 'important');
        if (isVisible) render();
      }
      return isVisible;
    }
  };
}

module.exports = {
  setupKeymapDebugOverlay
};
