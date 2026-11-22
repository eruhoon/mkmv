/**
 * mkmv NW.js & Steamworks (Greenworks) Compatibility Module (Shim)
 *
 * 기능:
 * 1. NW.js 가상 호환 객체 (createNwShim)
 *    - App.quit, fullPath, dataPath
 *    - Window.get() 창 크기, 전체화면 정보 및 리사이즈 no-op 인터셉트
 *    - Shell.openExternal 웹 브라우저 링크 열기
 *    - Menu, MenuItem, Tray 가상 객체
 * 2. Steamworks 가상 Mock 객체 (createGreenworksShim)
 *    - 스팀 도전과제/오버레이 연동 플러그인 크래시 방지
 * 3. Module.prototype.require 가로채기
 *    - require('nw.gui') ➡️ nwShim 반환
 *    - require('greenworks') ➡️ greenworksShim 반환
 * 4. 창 크기 및 해상도 임의 조작 차단 (blockWindowResize & blockYanflyResolution)
 *    - window.resizeTo, resizeBy, moveTo, moveBy 비활성화
 *    - Yanfly.updateResolution() 차단
 * 5. NW.js 식별용 환경 버전 주입 (injectNwVersions)
 *    - process.versions['node-webkit'] = '0.13.0'
 */

const Module = require('module');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { createLogger } = require('./logger.js');
const logger = createLogger('mkmv-nw');

function createNwShim(gameDir, userOpt = {}) {
  return {
    App: {
      argv: [],
      fullPath: gameDir,
      dataPath: gameDir,
      quit: () => {
        try {
          require('electron').ipcRenderer.send('app-quit');
        } catch (e) {
          if (typeof window !== 'undefined') window.close();
        }
      }
    },
    Window: {
      get: () => ({
        x: 0,
        y: 0,
        width: (typeof window !== 'undefined' ? (window.innerWidth || window.screen.width) : 0) || userOpt.width || 1920,
        height: (typeof window !== 'undefined' ? (window.innerHeight || window.screen.height) : 0) || userOpt.height || 1080,
        isFullScreen: true,
        showDevTools: () => {},
        close: () => {
          try {
            require('electron').ipcRenderer.send('app-quit');
          } catch (e) {
            if (typeof window !== 'undefined') window.close();
          }
        },
        maximize: () => {},
        unmaximize: () => {},
        minimize: () => {},
        restore: () => {},
        enterFullscreen: () => {},
        leaveFullscreen: () => {},
        toggleFullscreen: () => {},
        resizeTo: (w, h) => {
          logger.verbose('Intercepted nw.Window.get().resizeTo:', w, h);
        },
        resizeBy: (dw, dh) => {
          logger.verbose('Intercepted nw.Window.get().resizeBy:', dw, dh);
        },
        moveTo: () => {},
        moveBy: () => {},
        focus: () => {},
        blur: () => {},
        on: () => {},
        menu: null
      })
    },
    Menu: function() { this.append = () => {}; },
    MenuItem: function() {},
    Tray: function() {},
    Shell: {
      openExternal: (url) => {
        try {
          require('electron').shell.openExternal(url);
        } catch (e) {}
      },
      openItem: () => {},
      showItemInFolder: () => {}
    }
  };
}

function createGreenworksShim(storageDir = null) {
  const profilePath = storageDir ? path.join(storageDir, 'save', 'steam-profile.json') : null;
  const emitter = new EventEmitter();

  function loadState() {
    if (profilePath) {
      try {
        if (fs.existsSync(profilePath)) {
          const parsed = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
          if (parsed && typeof parsed === 'object') {
            parsed.achievements = parsed.achievements && typeof parsed.achievements === 'object'
              ? parsed.achievements
              : {};
            return parsed;
          }
        }
      } catch (e) {
        logger.debug('Failed to load offline steam-profile.json, creating fresh state:', e.message);
      }
    }
    const accountId = crypto.randomBytes(4).readUInt32LE(0) || 1;
    return {
      screenName: 'Offline Player',
      accountId,
      steamId: String(76561197960265728n + BigInt(accountId)),
      achievements: {}
    };
  }

  const state = loadState();

  function persistState() {
    if (!profilePath) return;
    try {
      const dir = path.dirname(profilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(profilePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
    } catch (e) {
      logger.debug('Failed to persist offline steam-profile.json:', e.message);
    }
  }

  function invokeCallback(cb, ...args) {
    if (typeof cb === 'function') {
      try { cb(...args); } catch (e) {}
    }
  }

  return {
    init: () => true,
    initAPI: () => true,
    isSteamRunning: () => true,
    getAppId: () => 0,
    getCurrentGameLanguage: () => 'english',
    getSteamId: () => ({
      screenName: state.screenName,
      steamId: state.steamId,
      accountId: state.accountId,
      staticAccountId: state.accountId,
      level: 1,
      isValid: () => true
    }),
    activateAchievement: (name, successCb, errorCb) => {
      if (typeof name !== 'string' || !name) {
        invokeCallback(errorCb, new Error('Invalid achievement name'));
        return;
      }
      if (!state.achievements[name] || !state.achievements[name].achieved) {
        state.achievements[name] = {
          achieved: true,
          unlockTime: Math.floor(Date.now() / 1000)
        };
        persistState();
        logger.info(`Offline Steam achievement unlocked: ${name}`);
      }
      invokeCallback(successCb);
    },
    getAchievement: (name, successCb, errorCb) => {
      if (typeof name !== 'string' || !name) {
        invokeCallback(errorCb, new Error('Invalid achievement name'));
        return false;
      }
      const achieved = Boolean(state.achievements[name] && state.achievements[name].achieved);
      invokeCallback(successCb, achieved);
      return achieved;
    },
    clearAchievement: (name, successCb, errorCb) => {
      if (typeof name !== 'string' || !name) {
        invokeCallback(errorCb, new Error('Invalid achievement name'));
        return;
      }
      if (state.achievements[name]) {
        delete state.achievements[name];
        persistState();
      }
      invokeCallback(successCb);
    },
    getAchievementNames: () => Object.keys(state.achievements),
    getNumberOfAchievements: () => Object.keys(state.achievements).length,
    getNumberOfPlayers: (successCb) => {
      invokeCallback(successCb, 1);
      return 1;
    },
    activateGameOverlay: () => {},
    isGameOverlayEnabled: () => false,
    on: (...args) => emitter.on(...args),
    once: (...args) => emitter.once(...args),
    off: (...args) => emitter.off(...args),
    removeListener: (...args) => emitter.removeListener(...args),
    emit: (...args) => emitter.emit(...args),
    _events: emitter._events,
    ugcGetItems: (_opts, _type, _filter, successCb) => invokeCallback(successCb, []),
    ugcGetUserItems: (_opts, _type, _sort, _filter, successCb) => invokeCallback(successCb, [])
  };
}

function hookRequire(nwShim, greenworksShim) {
  if (Module.prototype._mkmvNwHooked) return;
  Module.prototype._mkmvNwHooked = true;

  const originalRequire = Module.prototype.require;
  Module.prototype.require = function(id) {
    if (id === 'nw.gui') {
      return nwShim;
    }
    if (typeof id === 'string' && id.includes('greenworks')) {
      return greenworksShim;
    }
    return originalRequire.apply(this, arguments);
  };
}

function blockWindowResize() {
  if (typeof window === 'undefined') return;

  const noop = function() {};
  try {
    Object.defineProperty(window, 'resizeTo', { value: noop, writable: false, configurable: true });
    Object.defineProperty(window, 'resizeBy', { value: noop, writable: false, configurable: true });
    Object.defineProperty(window, 'moveTo', { value: noop, writable: false, configurable: true });
    Object.defineProperty(window, 'moveBy', { value: noop, writable: false, configurable: true });
  } catch (e) {
    window.resizeTo = noop;
    window.resizeBy = noop;
    window.moveTo = noop;
    window.moveBy = noop;
  }
}

function blockYanflyResolution() {
  if (typeof window === 'undefined') return;

  window.Imported = window.Imported || {};
  window.Imported.ScreenResolution = true;

  let cleanupTimer = null;
  const yanflyGuardTimer = setInterval(() => {
    if (window.Yanfly && window.Yanfly.updateResolution) {
      window.Yanfly.updateResolution = function() {
        logger.debug('Blocked Yanfly.updateResolution()');
      };
      clearInterval(yanflyGuardTimer);
      if (cleanupTimer) clearTimeout(cleanupTimer);
    }
  }, 30);
  cleanupTimer = setTimeout(() => clearInterval(yanflyGuardTimer), 15000);
  if (cleanupTimer && cleanupTimer.unref) cleanupTimer.unref();
  if (yanflyGuardTimer && yanflyGuardTimer.unref) yanflyGuardTimer.unref();
}

function injectNwVersions() {
  if (typeof process === 'undefined' || !process.versions) return;

  if (!process.versions['node-webkit']) {
    process.versions['node-webkit'] = '0.13.0';
  }
  if (!process.versions['nw']) {
    process.versions['nw'] = '0.13.0';
  }
  if (!process.versions['nw-flavor']) {
    process.versions['nw-flavor'] = 'normal';
  }
}

function setupNwShim(options = {}) {
  const { gameDir = process.cwd(), gameRootDir = null, userOpt = {} } = options;

  const nwShim = createNwShim(gameDir, userOpt);
  const greenworksShim = createGreenworksShim(gameRootDir);

  hookRequire(nwShim, greenworksShim);

  if (typeof window !== 'undefined') {
    window.nw = nwShim;
    window.nwGui = nwShim;
    window.greenworks = greenworksShim;
    window.PluginManagerEx = window.PluginManagerEx || { registerCommand: () => {} };
    window.Skill_Sequencer = window.Skill_Sequencer || function() {};
  }

  blockWindowResize();
  blockYanflyResolution();
  injectNwVersions();

  return { nwShim, greenworksShim };
}

module.exports = {
  setupNwShim,
  createNwShim,
  createGreenworksShim,
  hookRequire,
  blockWindowResize,
  blockYanflyResolution,
  injectNwVersions
};
