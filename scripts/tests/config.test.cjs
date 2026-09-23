const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  loadConfig,
  detectHardwareProfile,
  resolveEffectiveProfile,
  resolveEffectiveEngine,
  PROFILE_DEFAULTS
} = require('../../template/modules/config.js');

console.log('[test] Testing config module...');

// 1. Test auto detection on current machine
const detected = detectHardwareProfile();
console.log(`[test] Hardware profile detected: ${detected} (total memory: ${Math.round(os.totalmem() / 1024 / 1024)}MB)`);
assert(['high', 'medium', 'low'].includes(detected), 'Detected profile must be high, medium, or low');
assert.ok(PROFILE_DEFAULTS.high && PROFILE_DEFAULTS.medium && PROFILE_DEFAULTS.low, 'PROFILE_DEFAULTS must define high, medium, and low');

// Test memory thresholds for passive vs active cooling devices
assert.strictEqual(detectHardwareProfile(8192), 'high', '8GB active cooling device (Odin 2/3) should be high');
assert.strictEqual(detectHardwareProfile(3924), 'medium', '4GB passive device (RG Vita Pro) should be medium to prevent overheating');
assert.strictEqual(detectHardwareProfile(2048), 'medium', '2GB device should be medium');
assert.strictEqual(detectHardwareProfile(1024), 'low', '1GB device (RG35XX/H700) should be low');

// 2. Test resolveEffectiveProfile
assert.strictEqual(resolveEffectiveProfile({ performanceProfile: 'high' }), 'high');
assert.strictEqual(resolveEffectiveProfile({ performanceProfile: 'medium' }), 'medium');
assert.strictEqual(resolveEffectiveProfile({ performanceProfile: 'low' }), 'low');
assert.strictEqual(resolveEffectiveProfile({ lowMemoryMode: true }), 'low');
assert.strictEqual(resolveEffectiveProfile({ lowMemoryMode: false }), 'high');

// 2-1. Test resolveEffectiveEngine
assert.deepStrictEqual(resolveEffectiveEngine('mz'), { engine: 'mz', isMZ: true, mode: 'manual' });
assert.deepStrictEqual(resolveEffectiveEngine('mv'), { engine: 'mv', isMZ: false, mode: 'manual' });
assert.deepStrictEqual(resolveEffectiveEngine('MZ'), { engine: 'mz', isMZ: true, mode: 'manual' });
assert.deepStrictEqual(resolveEffectiveEngine('MV'), { engine: 'mv', isMZ: false, mode: 'manual' });

// 3. Test loadConfig with mock directories
const tempDir = path.join(__dirname, 'temp_test_config');
fs.mkdirSync(tempDir, { recursive: true });

try {
  // Test runtime default
  fs.writeFileSync(path.join(tempDir, 'mkmv.json'), JSON.stringify({
    performanceProfile: 'high',
    fastForwardSpeed: 3
  }));

  const config = loadConfig(tempDir, tempDir);
  assert.strictEqual(config.performanceProfile, 'high');
  assert.strictEqual(config.effectiveProfile, 'high');
  assert.strictEqual(config.engineVersion, 'auto');
  assert.strictEqual(config.disableGpu, false);
  assert.strictEqual(config.maxOldSpaceSize, 512);
  assert.strictEqual(config.lowMemoryMode, false);
  assert.strictEqual(config.fastForwardSpeed, 3);

  // Test game-specific override
  const gameDir = path.join(tempDir, 'game');
  fs.mkdirSync(gameDir, { recursive: true });
  fs.writeFileSync(path.join(gameDir, 'mkmv.json'), JSON.stringify({
    performanceProfile: 'low',
    disableGpu: true,
    maxOldSpaceSize: 256,
    engineVersion: 'mz'
  }));

  const gameConfig = loadConfig(tempDir, gameDir);
  assert.strictEqual(gameConfig.performanceProfile, 'low');
  assert.strictEqual(gameConfig.effectiveProfile, 'low');
  assert.strictEqual(gameConfig.engineVersion, 'mz');
  assert.strictEqual(gameConfig.disableGpu, true);
  assert.strictEqual(gameConfig.maxOldSpaceSize, 256); // explicit override
  assert.strictEqual(gameConfig.lowMemoryMode, true);
  assert.strictEqual(gameConfig.fastForwardSpeed, 3); // inherited from runtime

  // Test auto-detection with mock MZ files
  const mzGameDir = path.join(tempDir, 'mz_game');
  fs.mkdirSync(path.join(mzGameDir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(mzGameDir, 'js', 'rmmz_core.js'), '// MZ');
  const mzDetected = resolveEffectiveEngine('auto', mzGameDir);
  assert.deepStrictEqual(mzDetected, { engine: 'mz', isMZ: true, mode: 'auto' });

  // Test auto-detection fallback with empty/MV files
  const mvGameDir = path.join(tempDir, 'mv_game');
  fs.mkdirSync(path.join(mvGameDir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(mvGameDir, 'js', 'rpg_core.js'), '// MV');
  const mvDetected = resolveEffectiveEngine('auto', mvGameDir);
  assert.deepStrictEqual(mvDetected, { engine: 'mv', isMZ: false, mode: 'auto' });

  // 4. Test logLevel resolution in config
  const { resolveEffectiveLogLevel } = require('../../template/modules/config.js');
  const { LOG_LEVELS } = require('../../template/modules/logger.js');
  assert.strictEqual(resolveEffectiveLogLevel({ logLevel: 'verbose' }), LOG_LEVELS.verbose);
  assert.strictEqual(resolveEffectiveLogLevel({ logLevel: 'error' }), LOG_LEVELS.error);
  assert.strictEqual(resolveEffectiveLogLevel({ logLevel: 'warn' }), LOG_LEVELS.warn);
  assert.strictEqual(resolveEffectiveLogLevel({ logLevel: 'debug' }), LOG_LEVELS.debug);
  assert.strictEqual(resolveEffectiveLogLevel({}, LOG_LEVELS.debug), LOG_LEVELS.debug);

  // Test logLevel override via mkmv.json
  fs.writeFileSync(path.join(gameDir, 'mkmv.json'), JSON.stringify({
    logLevel: 'verbose'
  }));
  const logTestConfig = loadConfig(tempDir, gameDir);
  assert.strictEqual(logTestConfig.logLevel, 'verbose');
  assert.strictEqual(logTestConfig.effectiveLogLevel, LOG_LEVELS.verbose);

  console.log('[test] All config module tests passed successfully!');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
