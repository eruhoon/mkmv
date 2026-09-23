/**
 * mkmv Preload Bootstrap Orchestrator
 *
 * 이 스크립트는 Electron 렌더러가 시작될 때 가장 먼저 실행되는 메인 부트스트랩 스크립트입니다.
 * 각 기능별 모듈을 로드하고 게임 환경을 순차적으로 초기화합니다.
 */

console.log('[mkmv-preload] Preload script initializing...');
process.on('uncaughtException', (err) => {
  console.error('[mkmv-preload uncaughtException]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[mkmv-preload unhandledRejection]', reason);
});

const path = require('path');
const fs = require('fs');

// 1. 가상 파일시스템(대소문자/유니코드 리졸버, 세이브 보호, XHR 복구) 로드
const {
  detectGameDirectory,
  setupVirtualFs,
  resolveGamePath,
  origExistsSync,
  origReadFileSync
} = require(path.join(__dirname, 'modules', 'fs-virtual.js'));

// 2. 외부 모듈 로드
const { loadConfig, resolveEffectiveEngine } = require(path.join(__dirname, 'modules', 'config.js'));
const { setupNwShim } = require(path.join(__dirname, 'modules', 'nw-shim.js'));
const { setupInputModule } = require(path.join(__dirname, 'modules', 'input.js'));
const { setupImageLoader } = require(path.join(__dirname, 'modules', 'image-loader.js'));
const { setupFontModule } = require(path.join(__dirname, 'modules', 'font.js'));
const { setupGraphicsModule } = require(path.join(__dirname, 'modules', 'graphics.js'));
const { setupMemoryModule } = require(path.join(__dirname, 'modules', 'memory.js'));
const { setupAudioModule } = require(path.join(__dirname, 'modules', 'audio.js'));

// 3. 작업 디렉토리 및 메인 모듈 경로 자동 감지
const runtimeDir = __dirname;
let gameRootDir = process.env.MKMV_GAME_DIR || runtimeDir;

for (const arg of process.argv) {
  if (arg.startsWith('--game-dir=')) {
    const rawVal = arg.slice('--game-dir='.length);
    if (rawVal) gameRootDir = path.resolve(rawVal);
  }
}

const gameDir = detectGameDirectory(gameRootDir);

try {
  process.chdir(gameDir);
} catch (e) {}

// 가상 파일시스템(fs 패치, XHR/fetch 복구, DataManager 복구) 활성화
setupVirtualFs({ gameDir });

// 4. 사용자 정의 옵션 (mkmv.json / config.json) 로드
const userOpt = loadConfig(runtimeDir, gameRootDir);
const engineInfo = resolveEffectiveEngine(userOpt.engineVersion, gameDir, origExistsSync);
const isMZ = engineInfo.isMZ;
console.log(`[mkmv-preload] Engine detected: ${isMZ ? 'RPG Maker MZ' : 'RPG Maker MV'} (mode: ${engineInfo.mode})`);

if (!process.mainModule) {
  process.mainModule = { filename: path.join(gameDir, 'index.html') };
} else {
  process.mainModule.filename = path.join(gameDir, 'index.html');
}

// 5. 모듈 순차 초기화
setupInputModule({ userOpt, isMZ });
setupImageLoader({ resolveGamePath, origExistsSync, origReadFileSync, gameDir });
setupNwShim({ gameDir, userOpt });
setupGraphicsModule({ userOpt });
setupFontModule({ runtimeDir, gameDir, gameRootDir, origExistsSync, origReadFileSync });
setupMemoryModule({ userOpt });
setupAudioModule({ resolveGamePath, origExistsSync, origReadFileSync });
