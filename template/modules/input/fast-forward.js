/**
 * mkmv Input: Fast-Forward (Turbo) Mode & Thermal Frame-Skip
 */

const { createLogger } = require('../logger.js');
const { waitForCondition } = require('../bootstrap.js');
const logger = createLogger('mkmv-input');

function setupFastForward(userOpt, isMZ) {
  const getSpeedMultiplier = () => Math.max(1, Number(userOpt && userOpt.fastForwardSpeed) || 2);
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
      indicator.textContent = `▶▶ ${getSpeedMultiplier()}x`;
      document.body.appendChild(indicator);
    } else {
      indicator.textContent = `▶▶ ${getSpeedMultiplier()}x`;
    }
    return indicator;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ensureIndicator());
  } else {
    ensureIndicator();
  }

  function syncIndicator() {
    const badge = ensureIndicator();
    if (badge) {
      badge.textContent = `▶▶ ${getSpeedMultiplier()}x`;
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
  }

  function toggleFastForward() {
    if (userOpt && userOpt.fastForward === false) {
      isFastForward = false;
      syncIndicator();
      return;
    }
    isFastForward = !isFastForward;
    syncIndicator();
    logger.debug(`Fast forward toggled: ${isFastForward ? `${getSpeedMultiplier()}x` : '1x'}`);
  }

  window.addEventListener('keydown', (e) => {
    if (userOpt && userOpt.fastForward === false) return;
    const key = e.key ? e.key.toUpperCase() : '';
    const isR = key === 'R' || e.code === 'KeyR' || e.keyCode === 82;
    const isTab = key === 'TAB' || e.code === 'Tab' || e.keyCode === 9;
    if ((isR || isTab) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      toggleFastForward();
    }
  }, true);

  let renderSkipCounter = 0;

  waitForCondition(
    () => Boolean(window.SceneManager && window.SceneManager.updateMain),
    () => {
      const origUpdateMain = window.SceneManager.updateMain;
      window.SceneManager.updateMain = function() {
        const speedMultiplier = getSpeedMultiplier();
        if (!isFastForward || (userOpt && userOpt.fastForward === false)) {
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

        renderSkipCounter = (renderSkipCounter + 1) % 2;
        if (renderSkipCounter === 0 && typeof this.renderScene === 'function') {
          this.renderScene();
        }

        if (typeof this.requestUpdate === 'function') {
          this.requestUpdate();
        }
      };
      logger.debug(`Fast forward engine hook installed (${getSpeedMultiplier()}x available on R3/Tab with thermal frame-skip)`);
    },
    { intervalMs: 50, timeoutMs: 30000 }
  );

  return {
    refresh: () => {
      if (userOpt && userOpt.fastForward === false) {
        isFastForward = false;
      }
      syncIndicator();
    },
    isActive: () => isFastForward
  };
}

module.exports = {
  setupFastForward
};
