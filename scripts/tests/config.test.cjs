const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { loadConfig, detectHardwareProfile, resolveEffectiveProfile, PROFILE_DEFAULTS } = require('../../template/modules/config.js');

console.log('[test] Testing config module...');

// 1. Test auto detection on current machine
const detected = detectHardwareProfile();
console.log(`[test] Hardware profile detected: ${detected} (total memory: ${Math.round(os.totalmem() / 1024 / 1024)}MB)`);
assert(['high', 'medium', 'low'].includes(detected), 'Detected profile must be high, medium, or low');

// 2. Test resolveEffectiveProfile
assert.strictEqual(resolveEffectiveProfile({ performanceProfile: 'high' }), 'high');
assert.strictEqual(resolveEffectiveProfile({ performanceProfile: 'medium' }), 'medium');
assert.strictEqual(resolveEffectiveProfile({ performanceProfile: 'low' }), 'low');
assert.strictEqual(resolveEffectiveProfile({ lowMemoryMode: true }), 'low');
assert.strictEqual(resolveEffectiveProfile({ lowMemoryMode: false }), 'high');

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
    maxOldSpaceSize: 256
  }));

  const gameConfig = loadConfig(tempDir, gameDir);
  assert.strictEqual(gameConfig.performanceProfile, 'low');
  assert.strictEqual(gameConfig.effectiveProfile, 'low');
  assert.strictEqual(gameConfig.disableGpu, true);
  assert.strictEqual(gameConfig.maxOldSpaceSize, 256); // explicit override
  assert.strictEqual(gameConfig.lowMemoryMode, true);
  assert.strictEqual(gameConfig.fastForwardSpeed, 3); // inherited from runtime

  console.log('[test] All config module tests passed successfully!');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
