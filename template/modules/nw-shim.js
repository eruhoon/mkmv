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

function createGreenworksShim() {
  return {
    init: () => false,
    initAPI: () => false,
    isSteamRunning: () => false,
    getAppId: () => 0,
    activateAchievement: () => {},
    getAchievement: () => false,
    clearAchievement: () => {},
    getNumberOfPlayers: () => 0,
    activateGameOverlay: () => {},
    isGameOverlayEnabled: () => false,
    on: () => {},
    _events: {},
    ugcGetItems: () => {},
    ugcGetUserItems: () => {}
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
  const { gameDir = process.cwd(), userOpt = {} } = options;

  const nwShim = createNwShim(gameDir, userOpt);
  const greenworksShim = createGreenworksShim();

  hookRequire(nwShim, greenworksShim);

  if (typeof window !== 'undefined') {
    window.nw = nwShim;
    window.nwGui = nwShim;
    window.greenworks = greenworksShim;
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
