/**
 * mkmv Memory & Performance Management Module
 *
 * 기능:
 * 1. FPS 카운터 및 성능 오버레이 (setupFpsMeter)
 *    - 알만툴 내장 Graphics._fpsMeter 최상단 표시
 *    - 또는 DOM 기반 경량 FPS 카운터 오버레이 렌더링
 * 2. 저사양 1GB 기기용 메모리 안정화 및 가비지 컬렉션(GC) 관리 (setupLowMemoryManager)
 *    - 씬 전환(Scene_Base.prototype.terminate) 및 맵 이동(Scene_Map.prototype.onMapLoaded) 시 window.gc() 수동 수거
 *    - 배속 플레이 시 메모리 누적 방지: 유휴 GC 주기적 실행 및 RSS/Heap 사용량 로깅
 */

const { createLogger } = require('./logger.js');
const logger = createLogger('mkmv-mem');

function setupFpsMeter(userOpt = {}) {
  if (!userOpt.showFps || typeof window === 'undefined') return;

  let activated = false;

  const hookMvMeter = () => {
    if (window.Graphics) {
      if (window.Graphics._modifyExistingElements) {
        const origModify = window.Graphics._modifyExistingElements;
        window.Graphics._modifyExistingElements = function() {
          if (origModify) origModify.apply(this, arguments);
          if (window.Graphics._fpsMeter && window.Graphics._fpsMeter.container) {
            window.Graphics._fpsMeter.container.style.setProperty('z-index', '2147483640', 'important');
          }
          if (window.Graphics._modeBox) {
            window.Graphics._modeBox.style.setProperty('z-index', '2147483639', 'important');
          }
        };
      }

      if (window.Graphics._fpsMeter) {
        try {
          window.Graphics.showFps();
          if (typeof window.Graphics._fpsMeter.showFps === 'function') {
            window.Graphics._fpsMeter.showFps();
          }
          if (window.Graphics._fpsMeter.container) {
            window.Graphics._fpsMeter.container.style.setProperty('z-index', '2147483640', 'important');
            window.Graphics._fpsMeter.container.style.display = 'block';
          }
          if (window.Graphics._modeBox) {
            window.Graphics._modeBox.style.setProperty('z-index', '2147483639', 'important');
            window.Graphics._modeBox.style.opacity = '1';
          }
          activated = true;
        } catch (e) {}
      }
    }
  };

  const mvTimer = setInterval(hookMvMeter, 100);
  const mvCleanup = setTimeout(() => clearInterval(mvTimer), 25000);
  if (mvCleanup && mvCleanup.unref) mvCleanup.unref();
  if (mvTimer && mvTimer.unref) mvTimer.unref();

  const fallbackTimer = setTimeout(() => {
    if (!activated && (!window.Graphics || !window.Graphics._fpsMeter)) {
      createFallbackFpsOverlay();
    }
  }, 6000);
  if (fallbackTimer && fallbackTimer.unref) fallbackTimer.unref();
}

function createFallbackFpsOverlay() {
  if (typeof document === 'undefined' || document.getElementById('mkmv-fps-counter')) return;

  const overlay = document.createElement('div');
  overlay.id = 'mkmv-fps-counter';
  overlay.style.setProperty('position', 'fixed', 'important');
  overlay.style.setProperty('top', '10px', 'important');
  overlay.style.setProperty('left', '12px', 'important');
  overlay.style.setProperty('z-index', '2147483647', 'important');
  overlay.style.setProperty('background-color', 'rgba(0, 0, 0, 0.75)', 'important');
  overlay.style.setProperty('color', '#00ff66', 'important');
  overlay.style.setProperty('font-family', 'monospace, sans-serif', 'important');
  overlay.style.setProperty('font-size', '14px', 'important');
  overlay.style.setProperty('font-weight', 'bold', 'important');
  overlay.style.setProperty('padding', '3px 8px', 'important');
  overlay.style.setProperty('border-radius', '4px', 'important');
  overlay.style.setProperty('border', '1px solid rgba(0, 255, 102, 0.5)', 'important');
  overlay.style.setProperty('pointer-events', 'none', 'important');
  overlay.style.setProperty('user-select', 'none', 'important');
  overlay.style.setProperty('display', 'block', 'important');
  overlay.textContent = 'FPS: --';

  const attach = () => {
    if (document.body) {
      document.body.appendChild(overlay);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) document.body.appendChild(overlay);
      });
    }
  };
  attach();

  let frameCount = 0;
  let lastTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function updateFpsLoop(now) {
    frameCount++;
    const elapsed = now - lastTime;
    if (elapsed >= 500) {
      const currentFps = Math.round((frameCount * 1000) / elapsed);
      overlay.textContent = `FPS: ${currentFps}`;
      frameCount = 0;
      lastTime = now;

      if (overlay.style.zIndex !== '2147483647') {
        overlay.style.setProperty('z-index', '2147483647', 'important');
      }
      if (document.body && overlay.parentNode !== document.body) {
        document.body.appendChild(overlay);
      }
    }
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(updateFpsLoop);
    }
  }
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(updateFpsLoop);
  }
}

function setupLowMemoryManager(userOpt = {}) {
  if (userOpt.lowMemoryMode === false || typeof window === 'undefined') return;

  // 씬 전환(메뉴 진입/퇴출 등) 시 가비지 컬렉션 실행
  const patchSceneCleanup = () => {
    if (window.Scene_Base && window.Scene_Base.prototype) {
      const origTerminate = window.Scene_Base.prototype.terminate;
      window.Scene_Base.prototype.terminate = function() {
        origTerminate.apply(this, arguments);
        if (window.gc) {
          setTimeout(() => {
            try { if (window.gc) window.gc(); } catch (e) {}
          }, 100);
        }
      };
      return true;
    }
    return false;
  };

  // 맵 이동 및 로딩 완료 시 이전 맵 메모리 즉시 수거
  const patchMapCleanup = () => {
    if (window.Scene_Map && window.Scene_Map.prototype) {
      const origOnMapLoaded = window.Scene_Map.prototype.onMapLoaded;
      window.Scene_Map.prototype.onMapLoaded = function() {
        origOnMapLoaded.apply(this, arguments);
        if (window.gc) {
          setTimeout(() => {
            try { if (window.gc) window.gc(); } catch (e) {}
          }, 150);
        }
      };
      return true;
    }
    return false;
  };

  let sceneHooked = false;
  let mapHooked = false;
  let memCleanup = null;
  const memTimer = setInterval(() => {
    if (!sceneHooked) sceneHooked = patchSceneCleanup();
    if (!mapHooked) mapHooked = patchMapCleanup();
    if (sceneHooked && mapHooked) {
      clearInterval(memTimer);
      if (memCleanup) clearTimeout(memCleanup);
      logger.debug('Low memory scene & map GC installed successfully');
    }
  }, 50);
  memCleanup = setTimeout(() => clearInterval(memTimer), 20000);
  if (memCleanup && memCleanup.unref) memCleanup.unref();
  if (memTimer && memTimer.unref) memTimer.unref();

  // 배속 플레이 시 메모리 누적 방지: 유휴 GC 및 메모리 로깅
  const gcIntervalMs = (userOpt.gcIntervalSeconds !== undefined ? userOpt.gcIntervalSeconds : 30) * 1000;
  if (gcIntervalMs === 0) return;
  let logCounter = 0;
  const gcTimer = setInterval(() => {
    try {
      if (window.gc) window.gc();

      logCounter++;
      if (logCounter % 2 === 0 && process && process.memoryUsage) {
        const mem = process.memoryUsage();
        const rssMB = Math.round(mem.rss / 1024 / 1024);
        const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
        logger.debug(`RSS: ${rssMB}MB | Heap: ${heapUsedMB}/${heapTotalMB}MB`);
      }
    } catch (e) {}
  }, gcIntervalMs);
  if (gcTimer && gcTimer.unref) gcTimer.unref();
}

function setupMemoryModule(options = {}) {
  const { userOpt = {} } = options;
  setupFpsMeter(userOpt);
  setupLowMemoryManager(userOpt);
}

module.exports = {
  setupMemoryModule,
  setupFpsMeter,
  createFallbackFpsOverlay,
  setupLowMemoryManager
};
