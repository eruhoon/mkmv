/**
 * mkmv VFS RPG Maker MZ Save Unification & Migration
 */

const path = require('path');
const fs = require('fs');
const { createLogger } = require('../logger.js');
const { waitForCondition } = require('../bootstrap.js');
const {
  getActiveState,
  getLegacySaveDirs,
  origExistsSync,
  origStatSync,
  origReaddirSync,
  origCopyFileSync,
  origMkdirSync
} = require('./path-resolver.js');

const logger = createLogger('mkmv-vfs');

function setupMzSaveManager(options = {}) {
  const state = getActiveState();
  const gameRootDir = options.gameRootDir || state.activeGameRootDir;
  const gameDir = options.gameDir || state.activeGameDir;
  if (!gameRootDir || !gameDir) return;

  const targetSaveDir = path.resolve(gameRootDir, 'save');
  const legacySaveDir = path.resolve(gameDir, 'save');

  try {
    if (!origExistsSync.call(fs, targetSaveDir)) {
      origMkdirSync.call(fs, targetSaveDir, { recursive: true });
    }
    if (!origExistsSync.call(fs, legacySaveDir)) {
      origMkdirSync.call(fs, legacySaveDir, { recursive: true });
    }
  } catch (e) {}

  try {
    const legacyDirs = getLegacySaveDirs();
    for (const legDir of legacyDirs) {
      if (origExistsSync.call(fs, legDir)) {
        const files = origReaddirSync.call(fs, legDir);
        for (const file of files) {
          if (file.endsWith('.rmmzsave') || file.endsWith('.rmmzsave.bak')) {
            const src = path.join(legDir, file);
            const dest = path.join(targetSaveDir, file);
            let shouldCopy = false;
            if (!origExistsSync.call(fs, dest)) {
              shouldCopy = true;
            } else {
              try {
                const srcStat = origStatSync.call(fs, src);
                const destStat = origStatSync.call(fs, dest);
                if (file === 'global.rmmzsave') {
                  if (srcStat.size > destStat.size) {
                    shouldCopy = true;
                  }
                } else if (srcStat.mtimeMs > destStat.mtimeMs && srcStat.size > 0) {
                  shouldCopy = true;
                }
              } catch (e) {}
            }
            if (shouldCopy) {
              logger.info(`Migrating legacy save file: ${file} -> ${dest}`);
              origCopyFileSync.call(fs, src, dest);
            }
          }
        }
      }
    }
  } catch (e) {
    logger.warn('Failed to migrate legacy save files:', e);
  }

  if (typeof window === 'undefined') return;

  const saveDirPathWithSlash = targetSaveDir.endsWith(path.sep) ? targetSaveDir : (targetSaveDir + path.sep);
  const patchSM = (sm) => {
    if (!sm || sm._mkmvSaveHooked) return;
    sm._mkmvSaveHooked = true;

    sm.isLocalMode = function() {
      return true;
    };

    sm.fileDirectoryPath = function() {
      return saveDirPathWithSlash;
    };

    const origSaveToLocalFile = sm.saveToLocalFile;
    sm.saveToLocalFile = function(saveName, zip) {
      const filePath = this.filePath(saveName);
      const dirPath = this.fileDirectoryPath();
      return new Promise((resolve, reject) => {
        try {
          if (!origExistsSync.call(fs, dirPath)) {
            origMkdirSync.call(fs, dirPath, { recursive: true });
          }
          fs.writeFileSync(filePath, zip, 'utf8');
          logger.info(`[mkmv-mz] Save successful: ${filePath} (${zip ? zip.length : 0} bytes)`);
          resolve();
        } catch (err) {
          logger.error(`[mkmv-mz] Save error for ${filePath}:`, err);
          if (typeof origSaveToLocalFile === 'function') {
            origSaveToLocalFile.call(this, saveName, zip).then(resolve).catch(reject);
          } else {
            reject(err);
          }
        }
      });
    };

    sm.loadFromLocalFile = function(saveName) {
      const filePath = this.filePath(saveName);
      return new Promise((resolve, reject) => {
        let data = this.fsReadFile(filePath);
        if (!data) {
          const legacyPath = path.join(legacySaveDir, saveName + '.rmmzsave');
          data = this.fsReadFile(legacyPath);
          if (data) {
            logger.info(`[mkmv-mz] Loaded save from legacy fallback: ${legacyPath}`);
            try {
              fs.writeFileSync(filePath, data, 'utf8');
            } catch (e) {}
          }
        }
        if (data) {
          resolve(data);
        } else {
          logger.warn(`[mkmv-mz] Savefile not found: ${filePath}`);
          reject(new Error("Savefile not found"));
        }
      });
    };

    sm.localFileExists = function(saveName) {
      const filePath = this.filePath(saveName);
      if (fs.existsSync(filePath)) return true;
      const legacyPath = path.join(legacySaveDir, saveName + '.rmmzsave');
      return fs.existsSync(legacyPath);
    };

    sm.removeLocalFile = function(saveName) {
      this.fsUnlink(this.filePath(saveName));
      try {
        const legacyPath = path.join(legacySaveDir, saveName + '.rmmzsave');
        this.fsUnlink(legacyPath);
      } catch (e) {}
    };

    logger.info(`Hooked StorageManager -> ${saveDirPathWithSlash}`);
  };

  if (window.StorageManager && typeof window.StorageManager.fileDirectoryPath === 'function') {
    patchSM(window.StorageManager);
  }

  try {
    let curSM = window.StorageManager;
    Object.defineProperty(window, 'StorageManager', {
      configurable: true,
      enumerable: true,
      get() {
        return curSM;
      },
      set(val) {
        curSM = val;
        if (val) patchSM(val);
      }
    });
  } catch (e) {
    logger.warn('Failed to defineProperty for window.StorageManager:', e);
  }

  waitForCondition(
    () => {
      if (window.StorageManager && typeof window.StorageManager.fileDirectoryPath === 'function') {
        patchSM(window.StorageManager);
        return Boolean(window.StorageManager._mkmvSaveHooked);
      }
      return false;
    },
    null,
    { intervalMs: 20, timeoutMs: 30000, runImmediately: false }
  );
}

module.exports = {
  setupMzSaveManager
};
