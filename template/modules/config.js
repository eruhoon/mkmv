const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger, setLogLevel, parseLogLevel, getLogLevel, LOG_LEVELS, IS_RELEASE } = require('./logger.js');

const PROFILE_DEFAULTS = {
  high: {
    disableGpu: false,
    maxOldSpaceSize: 512,
    lowMemoryMode: false,
    gcIntervalSeconds: 60,
    rendererProcessLimit: null,
    diskCacheSize: 33554432, // 32MB
    mediaCacheSize: 33554432
  },
  medium: {
    disableGpu: false,
    maxOldSpaceSize: 384,
    lowMemoryMode: false,
    gcIntervalSeconds: 45,
    rendererProcessLimit: 1,
    diskCacheSize: 16777216, // 16MB
    mediaCacheSize: 16777216
  },
  low: {
    disableGpu: true,
    maxOldSpaceSize: 128,
    lowMemoryMode: true,
    gcIntervalSeconds: 30,
    rendererProcessLimit: 1,
    diskCacheSize: 1048576, // 1MB
    mediaCacheSize: 1048576
  }
};

function detectHardwareProfile(customTotalMemMB) {
  try {
    const totalMemMB = typeof customTotalMemMB === 'number'
      ? customTotalMemMB
      : os.totalmem() / (1024 * 1024);

    if (totalMemMB >= 5500) {
      // 6GB+ or 8GB+ flagship devices with active cooling (Ayn Odin 2/3, Qualcomm Snapdragon, PC)
      return 'high';
    } else if (totalMemMB >= 1500) {
      // 2GB ~ 4GB passively cooled devices (RG Vita Pro, RK3576, RK3566)
      // Passive cooling handhelds overheat under 'high'; 'medium' maintains 60 FPS while keeping SoC cool
      return 'medium';
    } else {
      // 1GB devices (RK3326, H700, RG35XX)
      return 'low';
    }
  } catch (e) {
    return 'medium';
  }
}

function resolveEffectiveProfile(rawConfig) {
  let profile = rawConfig.performanceProfile;
  if (!profile || profile === 'auto') {
    if (rawConfig.lowMemoryMode === true) {
      return 'low';
    } else if (rawConfig.lowMemoryMode === false) {
      return 'high';
    }
    return detectHardwareProfile();
  }
  if (profile !== 'high' && profile !== 'medium' && profile !== 'low') {
    return 'medium';
  }
  return profile;
}

function resolveEffectiveLogLevel(rawConfig, defaultFallback = null) {
  if (rawConfig && rawConfig.logLevel !== undefined && rawConfig.logLevel !== null) {
    return parseLogLevel(rawConfig.logLevel, defaultFallback ?? (IS_RELEASE ? LOG_LEVELS.error : LOG_LEVELS.debug));
  }
  return defaultFallback ?? (IS_RELEASE ? LOG_LEVELS.error : LOG_LEVELS.debug);
}

function readJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    logger.error(`Failed to read JSON from ${filePath}:`, e);
  }
  return null;
}

function loadConfig(runtimeDir, gameRootDir) {
  const commonDefaults = {
    width: 1920,
    height: 1080,
    fullscreen: true,
    autoDetectResolution: true,
    forceDeviceScaleFactor: 1.0,
    pixelated: true,
    scaling: 'fit',
    hideCursor: false,
    disableTouch: false,
    showFps: false,
    debugKeymap: false,
    disableNativeGamepad: true,
    fastForward: true,
    fastForwardSpeed: 2,
    performanceProfile: 'auto',
    engineVersion: 'auto',
    logLevel: null
  };

  const rawRuntimeConfig = readJsonFile(path.join(runtimeDir, 'mkmv.json'))
    || readJsonFile(path.join(runtimeDir, 'config.json'))
    || {};

  let rawGameConfig = {};
  if (gameRootDir && gameRootDir !== runtimeDir) {
    rawGameConfig = readJsonFile(path.join(gameRootDir, 'mkmv.json'))
      || readJsonFile(path.join(gameRootDir, 'config.json'))
      || {};
  }

  // Combined explicit user options (game config overrides runtime config)
  const userOverrides = Object.assign({}, rawRuntimeConfig, rawGameConfig);

  // Resolve log level and sync with logger
  if (userOverrides.logLevel !== undefined && userOverrides.logLevel !== null) {
    setLogLevel(userOverrides.logLevel);
  }

  // Resolve target performance profile
  const effectiveProfile = resolveEffectiveProfile(userOverrides);
  const profileDefaults = PROFILE_DEFAULTS[effectiveProfile] || PROFILE_DEFAULTS.medium;

  // Merge: Base defaults -> Profile defaults -> User explicit overrides
  const finalConfig = Object.assign(
    {},
    commonDefaults,
    profileDefaults,
    userOverrides
  );

  finalConfig.effectiveProfile = effectiveProfile;
  finalConfig.effectiveLogLevel = getLogLevel();

  // Backwards compatibility sync
  if (finalConfig.lowMemoryMode === undefined) {
    finalConfig.lowMemoryMode = (effectiveProfile === 'low');
  }

  return finalConfig;
}

function resolveEffectiveEngine(engineVersion, gameDir, existsSyncFn = fs.existsSync) {
  const normalized = (typeof engineVersion === 'string' ? engineVersion.toLowerCase().trim() : '') || 'auto';
  if (normalized === 'mz') {
    return { engine: 'mz', isMZ: true, mode: 'manual' };
  }
  if (normalized === 'mv') {
    return { engine: 'mv', isMZ: false, mode: 'manual' };
  }

  // 'auto' or unspecified: detect engine by core files
  let isMZ = false;
  if (gameDir) {
    try {
      const mzCore = path.join(gameDir, 'js', 'rmmz_core.js');
      const mzManagers = path.join(gameDir, 'js', 'rmmz_managers.js');
      if (existsSyncFn(mzCore) || existsSyncFn(mzManagers)) {
        isMZ = true;
      }
    } catch (e) {}
  }

  return { engine: isMZ ? 'mz' : 'mv', isMZ, mode: 'auto' };
}

module.exports = {
  loadConfig,
  detectHardwareProfile,
  resolveEffectiveProfile,
  resolveEffectiveEngine,
  resolveEffectiveLogLevel,
  PROFILE_DEFAULTS
};

