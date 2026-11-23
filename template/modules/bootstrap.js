/**
 * mkmv Shared Bootstrap & Polling Utilities
 *
 * - waitForCondition: 전역 객체/프로토타입 초기화를 대기하는 단일 폴링 헬퍼 (.unref() 및 cleanup 타이머 일관 보장)
 * - resolveGameRootDir: CLI 인자(--game-dir) 및 환경변수 기반 게임 루트 디렉토리 해석
 */

const path = require('path');

function waitForCondition(predicate, onReady, options = {}) {
  const {
    intervalMs = 50,
    timeoutMs = 15000,
    runImmediately = true,
    unref = true
  } = options;

  if (runImmediately) {
    try {
      if (predicate()) {
        if (typeof onReady === 'function') onReady();
        return () => {};
      }
    } catch (e) {}
  }

  let cleanupTimer = null;
  let timer = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
  };

  timer = setInterval(() => {
    try {
      if (predicate()) {
        stop();
        if (typeof onReady === 'function') onReady();
      }
    } catch (e) {}
  }, intervalMs);

  cleanupTimer = setTimeout(stop, timeoutMs);

  if (unref) {
    if (timer && typeof timer.unref === 'function') timer.unref();
    if (cleanupTimer && typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
  }

  return stop;
}

function resolveGameRootDir(runtimeDir, argv = process.argv, env = process.env) {
  let gameRootDir = (env && env.MKMV_GAME_DIR) || runtimeDir;
  if (Array.isArray(argv)) {
    for (const arg of argv) {
      if (typeof arg === 'string' && arg.startsWith('--game-dir=')) {
        const rawVal = arg.slice('--game-dir='.length);
        if (rawVal) gameRootDir = path.resolve(rawVal);
      }
    }
  }
  return gameRootDir;
}

module.exports = {
  waitForCondition,
  resolveGameRootDir
};
