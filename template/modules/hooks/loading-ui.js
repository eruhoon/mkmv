/**
 * mkmv Engine Hooks: Stall Loading Indicator Badge
 */

function applyLoadingNotice() {
  if (typeof window === 'undefined' || !window.DataManager || !window.Scene_Map || !window.Scene_Battle) {
    return false;
  }
  if (window.DataManager._mkmvLoadingHooked) return true;
  window.DataManager._mkmvLoadingHooked = true;

  let badge = null;
  let showTimer = null;
  let maxTimer = null;

  function ensureBadge() {
    if (badge || typeof document === 'undefined') return badge;
    const el = document.createElement('div');
    el.id = 'mkmv-loading-notice';
    el.textContent = 'Loading...';
    el.style.setProperty('position', 'fixed', 'important');
    el.style.setProperty('bottom', '14px', 'important');
    el.style.setProperty('right', '16px', 'important');
    el.style.setProperty('z-index', '2147483647', 'important');
    el.style.setProperty('background-color', 'rgba(0, 0, 0, 0.78)', 'important');
    el.style.setProperty('color', '#ffffff', 'important');
    el.style.setProperty('font-family', 'sans-serif', 'important');
    el.style.setProperty('font-size', '14px', 'important');
    el.style.setProperty('font-weight', 'bold', 'important');
    el.style.setProperty('padding', '6px 12px', 'important');
    el.style.setProperty('border-radius', '4px', 'important');
    el.style.setProperty('border', '1px solid rgba(255, 255, 255, 0.25)', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    el.style.setProperty('user-select', 'none', 'important');
    el.style.setProperty('display', 'none', 'important');
    if (document.body) {
      document.body.appendChild(el);
    } else if (typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) document.body.appendChild(el);
      });
    }
    badge = el;
    return badge;
  }

  function showLoading(afterMs = 1000) {
    hideLoading();
    const el = ensureBadge();
    if (!el) return;

    const trigger = () => {
      el.style.setProperty('display', 'block', 'important');
      maxTimer = setTimeout(hideLoading, 30000);
      if (maxTimer && maxTimer.unref) maxTimer.unref();
    };

    if (afterMs <= 0) {
      trigger();
    } else {
      showTimer = setTimeout(trigger, afterMs);
      if (showTimer && showTimer.unref) showTimer.unref();
    }
  }

  function hideLoading() {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
    if (badge) {
      badge.style.setProperty('display', 'none', 'important');
    }
  }

  function isFromMenu() {
    const sm = window.SceneManager;
    const prev = sm ? sm._previousClass : null;
    return Boolean(
      prev &&
      typeof window.Scene_MenuBase === 'function' &&
      (prev === window.Scene_MenuBase || prev.prototype instanceof window.Scene_MenuBase)
    );
  }

  function isFromTitle() {
    const sm = window.SceneManager;
    const scene = sm ? sm._scene : null;
    return Boolean(scene && typeof window.Scene_Title === 'function' && scene instanceof window.Scene_Title);
  }

  if (typeof window.DataManager.loadGame === 'function') {
    const origLoadGame = window.DataManager.loadGame;
    window.DataManager.loadGame = function() {
      showLoading(250);
      const res = origLoadGame.apply(this, arguments);
      if (res === false) hideLoading();
      return res;
    };
  }

  if (typeof window.DataManager.setupNewGame === 'function') {
    const origSetupNewGame = window.DataManager.setupNewGame;
    window.DataManager.setupNewGame = function() {
      if (isFromTitle()) showLoading(250);
      return origSetupNewGame.apply(this, arguments);
    };
  }

  if (window.Scene_Map.prototype) {
    if (typeof window.Scene_Map.prototype.onMapLoaded === 'function') {
      const origOnMapLoaded = window.Scene_Map.prototype.onMapLoaded;
      window.Scene_Map.prototype.onMapLoaded = function() {
        if (!isFromMenu()) showLoading(1000);
        return origOnMapLoaded.apply(this, arguments);
      };
    }
    if (typeof window.Scene_Map.prototype.start === 'function') {
      const origMapStart = window.Scene_Map.prototype.start;
      window.Scene_Map.prototype.start = function() {
        const res = origMapStart.apply(this, arguments);
        hideLoading();
        return res;
      };
    }
  }

  if (window.Scene_Battle.prototype) {
    if (typeof window.Scene_Battle.prototype.createDisplayObjects === 'function') {
      const origCreateBattle = window.Scene_Battle.prototype.createDisplayObjects;
      window.Scene_Battle.prototype.createDisplayObjects = function() {
        showLoading(1000);
        return origCreateBattle.apply(this, arguments);
      };
    }
    if (typeof window.Scene_Battle.prototype.start === 'function') {
      const origBattleStart = window.Scene_Battle.prototype.start;
      window.Scene_Battle.prototype.start = function() {
        const res = origBattleStart.apply(this, arguments);
        hideLoading();
        return res;
      };
    }
  }

  return true;
}

module.exports = {
  applyLoadingNotice
};
