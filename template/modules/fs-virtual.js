/**
 * mkmv Virtual File System & Save Protection Module
 *
 * 기능:
 * 1. Linux ext4 파일시스템 대소문자/유니코드 불일치 대응 (vfs/path-resolver.js)
 * 2. Node.js fs 가상화 패치 & 원자적 세이브 보호 (patchFs)
 * 3. Chromium FileURLLoaderFactory 버그 우회 및 DataManager 복구 (vfs/recovery.js)
 * 4. 알만툴 MZ 세이브 경로 일원화 및 마이그레이션 (vfs/mz-save.js)
 */

const path = require('path');
const fs = require('fs');
const { createLogger } = require('./logger.js');
const pathResolver = require('./vfs/path-resolver.js');
const { setupUniversalXhrRecovery, setupDataManagerRecovery } = require('./vfs/recovery.js');
const { setupMzSaveManager } = require('./vfs/mz-save.js');

const logger = createLogger('mkmv-vfs');

const {
  getActiveGameDir,
  getActiveState,
  setActiveGameConfig,
  setActiveGameDir,
  resolveCaseInsensitive,
  redirectMzSavePath,
  getLegacySaveDirs,
  getTargetSaveDirs,
  invalidatePathCaches,
  origExistsSync,
  origReadFileSync,
  origReadFile,
  origStatSync,
  origReaddirSync,
  origWriteFileSync,
  origRenameSync,
  origCopyFileSync,
  origOpenSync,
  origWriteSync,
  origFsyncSync,
  origCloseSync,
  origMkdirSync,
  origUnlinkSync
} = pathResolver;

function patchFs(baseDir = getActiveGameDir()) {
  if (fs._mkmvFsHooked) return;
  fs._mkmvFsHooked = true;

  const getBase = () => getActiveGameDir() || baseDir;

  fs.existsSync = function(p) {
    try {
      return origExistsSync.call(fs, resolveCaseInsensitive(p, getBase()));
    } catch (e) {
      return origExistsSync.call(fs, p);
    }
  };

  fs.readFileSync = function(p, options) {
    const resolved = resolveCaseInsensitive(p, getBase());
    let content;
    try {
      content = origReadFileSync.call(fs, resolved, options);
    } catch (err) {
      if (typeof p === 'string' && (p === 'lng.txt' || p.endsWith('/lng.txt') || p.endsWith('\\lng.txt'))) {
        logger.warn(`Missing ${p} detected, automatically generating fallback language 'ko'`);
        try {
          origWriteFileSync.call(fs, resolved, 'ko', 'utf8');
        } catch (e) {}
        return 'ko';
      }
      throw err;
    }

    if (typeof p === 'string' && (p === 'lng.txt' || p.endsWith('/lng.txt') || p.endsWith('\\lng.txt'))) {
      if (typeof content === 'string') {
        content = content.replace(/^\uFEFF/, '').trim();
      } else if (Buffer.isBuffer(content)) {
        const str = content.toString('utf8').replace(/^\uFEFF/, '').trim();
        content = options ? str : Buffer.from(str, 'utf8');
      }
    }

    if (typeof p === 'string' && (p.endsWith('.rpgsave') || p.endsWith('.rmmzsave')) && (!content || content.length === 0)) {
      const saveDir = path.dirname(resolved);
      const fileName = path.basename(resolved);
      const hiddenBakFile = path.join(saveDir, '.bak', fileName + '.bak');
      const legacyBakFile = resolved + '.bak';
      const targetBak = origExistsSync.call(fs, hiddenBakFile) ? hiddenBakFile : (origExistsSync.call(fs, legacyBakFile) ? legacyBakFile : null);

      if (targetBak) {
        logger.warn(`Corrupted 0-byte save detected for ${p}, restoring from ${targetBak}`);
        try {
          content = origReadFileSync.call(fs, targetBak, options);
        } catch (e) {}
      }
    }
    return content;
  };

  fs.statSync = function(p, options) {
    return origStatSync.call(fs, resolveCaseInsensitive(p, getBase()), options);
  };

  fs.readFile = function(p, ...args) {
    return origReadFile.call(fs, resolveCaseInsensitive(p, getBase()), ...args);
  };

  fs.writeFileSync = function(p, data, options) {
    invalidatePathCaches();
    let resolvedPath = resolveCaseInsensitive(p, getBase());
    const { activeIsMZ, activeGameRootDir } = getActiveState();

    if (activeIsMZ && activeGameRootDir) {
      const redirected = redirectMzSavePath(resolvedPath);
      if (redirected) {
        resolvedPath = redirected;
      }
    }

    const isSaveFile = typeof p === 'string' && (
      p.endsWith('.rpgsave') ||
      p.endsWith('.rmmzsave') ||
      p.includes('/save/') ||
      p.includes('\\save\\')
    );

    if (isSaveFile) {
      try {
        if (origExistsSync.call(fs, resolvedPath)) {
          try {
            const saveDir = path.dirname(resolvedPath);
            const bakDir = path.join(saveDir, '.bak');
            if (!origExistsSync.call(fs, bakDir)) {
              origMkdirSync.call(fs, bakDir, { recursive: true });
            }
            origCopyFileSync.call(fs, resolvedPath, path.join(bakDir, path.basename(resolvedPath) + '.bak'));
          } catch (e) {}
        }

        const tmpPath = resolvedPath + '.tmp.' + Date.now();
        const fd = origOpenSync.call(fs, tmpPath, 'w');
        try {
          origWriteSync.call(fs, fd, data);
          try { origFsyncSync.call(fs, fd); } catch (e) {}
        } finally {
          try { origCloseSync.call(fs, fd); } catch (e) {}
        }

        origRenameSync.call(fs, tmpPath, resolvedPath);
        invalidatePathCaches();
        return;
      } catch (err) {
        logger.warn('Atomic save failed, falling back to direct write:', err);
      }
    }
    const writeRes = origWriteFileSync.call(fs, resolvedPath, data, options);
    invalidatePathCaches();
    return writeRes;
  };

  fs.renameSync = function(oldPath, newPath) {
    let resolvedOld = resolveCaseInsensitive(oldPath, getBase());
    let resolvedNew = resolveCaseInsensitive(newPath, getBase());
    const { activeIsMZ, activeGameRootDir } = getActiveState();
    if (activeIsMZ && activeGameRootDir) {
      resolvedOld = redirectMzSavePath(resolvedOld) || resolvedOld;
      resolvedNew = redirectMzSavePath(resolvedNew) || resolvedNew;
    }
    const res = origRenameSync.call(fs, resolvedOld, resolvedNew);
    invalidatePathCaches();
    return res;
  };

  fs.readdirSync = function(p, options) {
    const { activeIsMZ, activeGameRootDir, activeGameDir } = getActiveState();
    if (activeIsMZ && activeGameRootDir && typeof p === 'string') {
      const normalized = path.resolve(activeGameDir, p);
      const isLegacy = getLegacySaveDirs().some(d => normalized === d || normalized === d + path.sep);
      const isTarget = getTargetSaveDirs().some(d => normalized === d || normalized === d + path.sep);
      if (isLegacy || isTarget) {
        const targetSaveDir = path.resolve(activeGameRootDir, 'save');
        const legacySaveDir = path.resolve(activeGameDir, 'save');
        const set = new Set();
        try {
          if (origExistsSync.call(fs, targetSaveDir)) {
            for (const f of origReaddirSync.call(fs, targetSaveDir, options)) set.add(f);
          }
        } catch (e) {}
        try {
          if (origExistsSync.call(fs, legacySaveDir)) {
            for (const f of origReaddirSync.call(fs, legacySaveDir, options)) set.add(f);
          }
        } catch (e) {}
        return Array.from(set);
      }
    }
    return origReaddirSync.call(fs, resolveCaseInsensitive(p, getBase()), options);
  };

  fs.mkdirSync = function(p, options) {
    let resolved = resolveCaseInsensitive(p, getBase());
    const { activeIsMZ, activeGameRootDir } = getActiveState();
    if (activeIsMZ && activeGameRootDir) {
      const redirected = redirectMzSavePath(resolved);
      if (redirected) {
        resolved = redirected;
      }
    }
    const res = origMkdirSync.call(fs, resolved, options);
    invalidatePathCaches();
    return res;
  };

  fs.unlinkSync = function(p) {
    let resolved = resolveCaseInsensitive(p, getBase());
    const { activeIsMZ, activeGameRootDir } = getActiveState();
    if (activeIsMZ && activeGameRootDir) {
      resolved = redirectMzSavePath(resolved) || resolved;
    }
    const res = origUnlinkSync.call(fs, resolved);
    invalidatePathCaches();
    return res;
  };
}

function setupVirtualFs(options = {}) {
  const { gameDir, gameRootDir, isMZ } = options;
  if (gameDir) setActiveGameDir(gameDir);
  if (gameRootDir || typeof isMZ === 'boolean') {
    setActiveGameConfig({ gameDir, gameRootDir, isMZ });
  }

  const state = getActiveState();
  patchFs(state.activeGameDir);
  setupUniversalXhrRecovery(state.activeGameDir);
  setupDataManagerRecovery(state.activeGameDir);

  if (state.activeIsMZ && state.activeGameRootDir) {
    setupMzSaveManager({ gameRootDir: state.activeGameRootDir, gameDir: state.activeGameDir });
  }
}

module.exports = {
  ...pathResolver,
  setupVirtualFs,
  setupMzSaveManager,
  setupUniversalXhrRecovery,
  patchFs,
  setupDataManagerRecovery
};
