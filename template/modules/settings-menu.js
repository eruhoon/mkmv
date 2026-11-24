/**
 * mkmv In-App Settings Menu Module
 *
 * 기능:
 * 1. M + Y 동시 입력으로 인앱 설정 오버레이 토글
 * 2. showFps, fastForward, targetFps, scaling, pixelated 등 즉시 반영(Live) 옵션 제어
 * 3. 변경 사항을 해당 게임/런타임의 mkmv.json에 자동 저장
 */

const { createLogger, setLogLevel } = require('./logger.js');
const { saveGameConfig } = require('./config.js');
const { injectResolutionStyles, patchGraphics, setTargetFps } = require('./graphics.js');
const { getNativeGamepads } = require('./input.js');

const logger = createLogger('mkmv-menu');

const SETTING_DEFINITIONS = [
  { key: 'showFps', label: 'Show FPS Counter', type: 'boolean', live: true },
  { key: 'fastForward', label: 'Fast Forward (R/Tab/R3)', type: 'boolean', live: true },
  { key: 'fastForwardSpeed', label: 'Fast Forward Speed', type: 'choice', choices: [2, 3, 4], format: (v) => `${v}x`, live: true },
  { key: 'targetFps', label: 'Target FPS Cap', type: 'choice', choices: [30, 40, 45, 60], format: (v) => `${v} FPS`, live: true },
  { key: 'scaling', label: 'Screen Scaling', type: 'choice', choices: ['fit', 'fill'], live: true },
  { key: 'pixelated', label: 'Pixelated Rendering', type: 'boolean', live: true },
  { key: 'debugKeymap', label: 'Keymap Debug Overlay', type: 'boolean', live: true },
  { key: 'hideCursor', label: 'Hide Mouse Cursor', type: 'boolean', live: true },
  { key: 'disableTouch', label: 'Disable Touch Input', type: 'boolean', live: true },
  { key: 'logLevel', label: 'Log Level', type: 'choice', choices: ['silent', 'error', 'warn', 'info', 'debug', 'verbose'], live: true },
  { key: 'gamepadProfile', label: 'Gamepad Profile', type: 'choice', choices: ['auto', 'standard', 'nintendo', 'retrogame_joypad'], live: true },
  { key: 'fullscreen', label: 'Fullscreen', type: 'boolean', live: false },
  { key: 'performanceProfile', label: 'Performance Profile', type: 'choice', choices: ['auto', 'high', 'medium', 'low'], live: false },
  { key: 'engineVersion', label: 'Engine Version', type: 'choice', choices: ['auto', 'mv', 'mz'], live: false },
  { key: 'disableNativeGamepad', label: 'Disable Native Gamepad', type: 'boolean', live: false },
  { key: 'assetCache', label: 'Asset Cache', type: 'boolean', live: false },
  { key: 'clearAssetCache', label: 'Clear Asset Cache', type: 'action', live: true }
];

function cycleSettingValue(def, currentValue, direction = 1) {
  if (def.type === 'boolean') {
    return !currentValue;
  }
  if (def.type === 'choice' && Array.isArray(def.choices) && def.choices.length > 0) {
    const idx = def.choices.indexOf(currentValue);
    if (idx === -1) {
      return def.choices[0];
    }
    const nextIdx = (idx + direction + def.choices.length) % def.choices.length;
    return def.choices[nextIdx];
  }
  return currentValue;
}

function formatSettingValue(def, value) {
  if (def.type === 'boolean') {
    return value ? 'ON' : 'OFF';
  }
  if (typeof def.format === 'function') {
    return def.format(value);
  }
  return String(value === undefined || value === null ? '-' : value);
}

function normalizeComboKey(e) {
  if (!e) return '';
  if (
    e.code === 'KeyM' || e.keyCode === 77 || (e.key && e.key.toUpperCase() === 'M') ||
    e.code === 'F1' || e.keyCode === 112 || (e.key && e.key.toUpperCase() === 'F1')
  ) {
    return 'M';
  }
  if (
    e.code === 'KeyY' || e.keyCode === 89 || (e.key && e.key.toUpperCase() === 'Y') ||
    e.code === 'Space' || e.keyCode === 32 || e.key === ' '
  ) {
    return 'Y';
  }
  return '';
}

function setupSettingsMenu(options = {}) {
  const {
    userOpt = {},
    runtimeDir,
    gameRootDir,
    controllers = {}
  } = options;
  const getFpsController = () => options.fpsController || controllers.fps || null;
  const getKeymapController = () => options.keymapController || controllers.keymap || null;
  const getFastForwardController = () => options.fastForwardController || controllers.fastForward || null;
  const getAssetCache = () => options.assetCache || controllers.assetCache || null;

  let isOpen = false;
  let selectedIndex = 0;
  let statusText = 'Changes auto-save to mkmv.json';
  let statusColor = '#9fb3c8';
  let cacheSizeLabel = 'Clear';
  let overlay = null;
  const pressedComboKeys = new Set();

  function refreshCacheSizeLabel() {
    const cache = getAssetCache();
    if (!cache || typeof cache.getCacheStats !== 'function') {
      cacheSizeLabel = 'N/A';
      return;
    }
    cache.getCacheStats().then((stats) => {
      const mb = ((stats && stats.totalBytes) || 0) / (1024 * 1024);
      cacheSizeLabel = stats && stats.fileCount > 0 ? `${mb.toFixed(1)} MB (${stats.fileCount})` : 'Empty';
      if (isOpen) render();
    }).catch(() => {});
  }

  function getCurrentValue(def) {
    if (def.key === 'clearAssetCache') {
      return cacheSizeLabel;
    }
    const fpsController = getFpsController();
    const keymapController = getKeymapController();
    if (def.key === 'showFps' && fpsController && typeof fpsController.isVisible === 'function') {
      return fpsController.isVisible();
    }
    if (def.key === 'debugKeymap' && keymapController && typeof keymapController.isVisible === 'function') {
      return keymapController.isVisible();
    }
    if (def.key === 'logLevel') {
      return userOpt.logLevel || 'debug';
    }
    if (def.key === 'gamepadProfile') {
      return userOpt.gamepadProfile || 'auto';
    }
    return userOpt[def.key];
  }

  function applySettingChange(def, nextValue) {
    if (def.type === 'action') {
      if (def.key === 'clearAssetCache') {
        const cache = getAssetCache();
        if (cache && typeof cache.clearCache === 'function') {
          cache.clearCache().then((res) => {
            const freedMB = ((res && res.freedBytes) || 0) / (1024 * 1024);
            cacheSizeLabel = 'Empty';
            statusText = `Cleared cache (${freedMB.toFixed(1)} MB freed)`;
            statusColor = '#6ee7b7';
            if (isOpen) render();
          }).catch(() => {});
        }
      }
      return;
    }

    userOpt[def.key] = nextValue;
    const fpsController = getFpsController();
    const keymapController = getKeymapController();
    const fastForwardController = getFastForwardController();

    switch (def.key) {
      case 'showFps':
        if (fpsController && typeof fpsController.setVisible === 'function') {
          fpsController.setVisible(nextValue);
        }
        break;
      case 'debugKeymap':
        if (keymapController && typeof keymapController.setVisible === 'function') {
          keymapController.setVisible(nextValue);
        }
        break;
      case 'fastForward':
      case 'fastForwardSpeed':
        if (fastForwardController && typeof fastForwardController.refresh === 'function') {
          fastForwardController.refresh();
        }
        break;
      case 'targetFps':
        setTargetFps(userOpt, nextValue);
        break;
      case 'scaling':
        patchGraphics(userOpt);
        if (typeof window !== 'undefined' && window.Graphics && typeof window.Graphics._updateAllElements === 'function') {
          window.Graphics._updateAllElements();
        }
        break;
      case 'pixelated':
      case 'hideCursor':
        injectResolutionStyles(userOpt);
        break;
      case 'logLevel':
        setLogLevel(nextValue);
        break;
      default:
        break;
    }

    try {
      saveGameConfig(runtimeDir, gameRootDir, { [def.key]: nextValue });
      statusText = def.live
        ? `Saved ${def.key} = ${formatSettingValue(def, nextValue)} ✓`
        : `Saved ${def.key} (Restart required) ✓`;
      statusColor = def.live ? '#00ff88' : '#ffd166';
    } catch (err) {
      logger.error('Failed to save mkmv.json from settings menu:', err);
      statusText = 'Failed to write mkmv.json';
      statusColor = '#ff6b6b';
    }
  }

  function render() {
    if (!overlay || !isOpen) return;

    const rowsHtml = SETTING_DEFINITIONS.map((def, idx) => {
      const val = getCurrentValue(def);
      const valStr = formatSettingValue(def, val);
      const isSelected = idx === selectedIndex;
      const rowBg = isSelected ? 'rgba(0, 229, 255, 0.16)' : 'transparent';
      const rowBorder = isSelected ? '1px solid #00e5ff' : '1px solid rgba(255,255,255,0.06)';
      const badge = def.live
        ? '<span style="font-size:10px; padding:1px 5px; border-radius:3px; background:rgba(0,255,136,0.14); color:#00ff88; margin-left:6px;">LIVE</span>'
        : '<span style="font-size:10px; padding:1px 5px; border-radius:3px; background:rgba(255,209,102,0.14); color:#ffd166; margin-left:6px;">RESTART</span>';
      const valColor = def.type === 'boolean'
        ? (val ? '#00ff88' : '#ff7b7b')
        : '#00e5ff';

      return `
        <div data-mkmv-idx="${idx}" style="display:flex; align-items:center; justify-content:space-between; padding:7px 10px; margin-bottom:4px; border-radius:6px; background:${rowBg}; border:${rowBorder}; cursor:pointer;">
          <div style="display:flex; align-items:center; font-size:13px; color:${isSelected ? '#ffffff' : '#d8e2ec'}; font-weight:${isSelected ? '700' : '500'};">
            <span>${isSelected ? '▶ ' : ''}${def.label}</span>${badge}
          </div>
          <div style="display:flex; align-items:center; gap:8px; font-family:monospace; font-size:13px; font-weight:bold; color:${valColor};">
            <span data-mkmv-dir="-1" style="padding:1px 6px; border-radius:4px; background:rgba(255,255,255,0.08); color:#cbd5e1;">◀</span>
            <span style="min-width:68px; text-align:center;">${valStr}</span>
            <span data-mkmv-dir="1" style="padding:1px 6px; border-radius:4px; background:rgba(255,255,255,0.08); color:#cbd5e1;">▶</span>
          </div>
        </div>
      `;
    }).join('');

    overlay.innerHTML = `
      <div id="mkmv-settings-panel" style="width:min(540px, 92vw); max-height:88vh; display:flex; flex-direction:column; background:#0d1526; color:#f1f5f9; border:2px solid #00e5ff; border-radius:10px; box-shadow:0 12px 40px rgba(0,0,0,0.85); font-family:sans-serif; overflow:hidden;">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; background:#121f38; border-bottom:1px solid rgba(0,229,255,0.3);">
          <div style="font-size:15px; font-weight:bold; color:#00e5ff; letter-spacing:0.5px;">⚙ MKMV SETTINGS</div>
          <div id="mkmv-settings-close" style="font-size:12px; color:#cbd5e1; background:rgba(255,255,255,0.08); padding:4px 9px; border-radius:5px; cursor:pointer;">✕ Close (Esc)</div>
        </div>
        <div id="mkmv-settings-list" style="padding:10px 12px; overflow-y:auto; flex:1;">
          ${rowsHtml}
        </div>
        <div style="padding:9px 14px; background:#0a101d; border-top:1px solid rgba(255,255,255,0.1); display:flex; flex-direction:column; gap:4px;">
          <div style="font-size:12px; color:${statusColor}; font-weight:600;">${statusText}</div>
          <div style="font-size:11px; color:#94a3b8;">↑↓ Select &nbsp;•&nbsp; ←→ / Enter / Z Change &nbsp;•&nbsp; Esc / X / M(Fn)+Y Close</div>
        </div>
      </div>
    `;

    const activeRow = overlay.querySelector(`[data-mkmv-idx="${selectedIndex}"]`);
    if (activeRow && typeof activeRow.scrollIntoView === 'function') {
      try { activeRow.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
  }

  function ensureOverlay() {
    if (typeof document === 'undefined' || !document.body) return null;
    if (!overlay) {
      overlay = document.getElementById('mkmv-settings-overlay');
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'mkmv-settings-overlay';
      overlay.style.setProperty('position', 'fixed', 'important');
      overlay.style.setProperty('inset', '0', 'important');
      overlay.style.setProperty('z-index', '2147483647', 'important');
      overlay.style.setProperty('background', 'rgba(0, 0, 0, 0.72)', 'important');
      overlay.style.setProperty('display', 'none', 'important');
      overlay.style.setProperty('align-items', 'center', 'important');
      overlay.style.setProperty('justify-content', 'center', 'important');
      overlay.style.setProperty('user-select', 'none', 'important');
      overlay.style.setProperty('pointer-events', 'auto', 'important');

      overlay.addEventListener('click', (e) => {
        if (!isOpen) return;
        if (e.target === overlay || (e.target && e.target.id === 'mkmv-settings-close')) {
          setOpen(false);
          return;
        }
        const row = e.target && e.target.closest ? e.target.closest('[data-mkmv-idx]') : null;
        if (row) {
          const idx = Number(row.getAttribute('data-mkmv-idx'));
          if (Number.isInteger(idx) && SETTING_DEFINITIONS[idx]) {
            selectedIndex = idx;
            const dirEl = e.target.closest ? e.target.closest('[data-mkmv-dir]') : null;
            const dir = dirEl ? Number(dirEl.getAttribute('data-mkmv-dir')) : 1;
            const def = SETTING_DEFINITIONS[idx];
            const nextVal = cycleSettingValue(def, getCurrentValue(def), dir);
            applySettingChange(def, nextVal);
            render();
          }
        }
      });

      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function setOpen(nextOpen) {
    isOpen = Boolean(nextOpen);
    if (typeof window !== 'undefined') {
      window.__mkmvSettingsMenuOpen = isOpen;
      if (isOpen && window.Input && typeof window.Input.clear === 'function') {
        try { window.Input.clear(); } catch (e) {}
      }
    }
    const el = ensureOverlay();
    if (el) {
      el.style.setProperty('display', isOpen ? 'flex' : 'none', 'important');
      if (isOpen) {
        if (document.body && el.parentNode !== document.body) {
          document.body.appendChild(el);
        }
        refreshCacheSizeLabel();
        render();
      }
    }
    logger.debug(`In-app settings menu ${isOpen ? 'opened' : 'closed'}`);
    return isOpen;
  }

  if (typeof window !== 'undefined') {
    const swallowEvent = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
    };

    window.addEventListener('keydown', (e) => {
      if (e._mkmvMenuHandled) return;
      e._mkmvMenuHandled = true;
      const comboKey = normalizeComboKey(e);
      if (comboKey) {
        pressedComboKeys.add(comboKey);
        if (!e.repeat && pressedComboKeys.has('M') && pressedComboKeys.has('Y')) {
          swallowEvent(e);
          setOpen(!isOpen);
          return;
        }
      }

      if (!isOpen) return;
      swallowEvent(e);

      const key = e.key ? e.key.toUpperCase() : '';
      const code = e.code || '';

      if (key === 'ESCAPE' || code === 'Escape' || e.keyCode === 27 || key === 'X' || code === 'KeyX' || e.keyCode === 88) {
        setOpen(false);
        return;
      }

      if (key === 'ARROWUP' || code === 'ArrowUp' || e.keyCode === 38) {
        selectedIndex = (selectedIndex - 1 + SETTING_DEFINITIONS.length) % SETTING_DEFINITIONS.length;
        render();
        return;
      }

      if (key === 'ARROWDOWN' || code === 'ArrowDown' || e.keyCode === 40) {
        selectedIndex = (selectedIndex + 1) % SETTING_DEFINITIONS.length;
        render();
        return;
      }

      if (key === 'ARROWLEFT' || code === 'ArrowLeft' || e.keyCode === 37) {
        const def = SETTING_DEFINITIONS[selectedIndex];
        applySettingChange(def, cycleSettingValue(def, getCurrentValue(def), -1));
        render();
        return;
      }

      if (
        key === 'ARROWRIGHT' || code === 'ArrowRight' || e.keyCode === 39 ||
        key === 'ENTER' || code === 'Enter' || e.keyCode === 13 ||
        key === 'Z' || code === 'KeyZ' || e.keyCode === 90 ||
        key === ' ' || code === 'Space' || e.keyCode === 32
      ) {
        const def = SETTING_DEFINITIONS[selectedIndex];
        applySettingChange(def, cycleSettingValue(def, getCurrentValue(def), 1));
        render();
      }
    }, true);

    window.addEventListener('keyup', (e) => {
      const comboKey = normalizeComboKey(e);
      if (comboKey) {
        pressedComboKeys.delete(comboKey);
      }
      if (isOpen) {
        swallowEvent(e);
      }
    }, true);

    window.addEventListener('keypress', (e) => {
      if (isOpen) {
        swallowEvent(e);
      }
    }, true);

    window.addEventListener('blur', () => {
      pressedComboKeys.clear();
    });

    // 물리 게임패드 M(Guide, btn 16) + Y(btn 3 또는 nintendo 프로필 시 btn 2) 동시 입력 감지
    let wasPadComboPressed = false;
    const padComboTimer = setInterval(() => {
      const pads = getNativeGamepads();
      const yBtnIdx = (userOpt && userOpt.gamepadProfile === 'nintendo') ? 2 : 3;
      let isPadComboPressed = false;
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (!pad || !pad.connected || !pad.buttons) continue;
        const mBtn = pad.buttons[16];
        const yBtn = pad.buttons[yBtnIdx];
        const mDown = Boolean(mBtn && (mBtn.pressed || mBtn.value > 0.5));
        const yDown = Boolean(yBtn && (yBtn.pressed || yBtn.value > 0.5));
        if (mDown && yDown) {
          isPadComboPressed = true;
          break;
        }
      }
      if (isPadComboPressed && !wasPadComboPressed) {
        setOpen(!isOpen);
      }
      wasPadComboPressed = isPadComboPressed;
    }, 50);
    if (padComboTimer && padComboTimer.unref) padComboTimer.unref();
  }

  return {
    isOpen: () => isOpen,
    setOpen,
    toggle: () => setOpen(!isOpen)
  };
}

module.exports = {
  SETTING_DEFINITIONS,
  cycleSettingValue,
  formatSettingValue,
  setupSettingsMenu
};
