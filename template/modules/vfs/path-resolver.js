/**
 * mkmv VFS Path Resolver & Shared Resource Helpers
 */

const path = require('path');
const fs = require('fs');

// 원본 fs 메서드 백업 (재귀 호출 방지 및 고속 직접 접근용)
const origExistsSync = fs.existsSync;
const origReadFileSync = fs.readFileSync;
const origReadFile = fs.readFile;
const origStatSync = fs.statSync;
const origReaddirSync = fs.readdirSync;
const origWriteFileSync = fs.writeFileSync;
const origRenameSync = fs.renameSync;
const origCopyFileSync = fs.copyFileSync;
const origOpenSync = fs.openSync;
const origWriteSync = fs.writeSync;
const origFsyncSync = fs.fsyncSync;
const origCloseSync = fs.closeSync;
const origMkdirSync = fs.mkdirSync;
const origUnlinkSync = fs.unlinkSync;
const origRealPathSync = fs.realpathSync;

function isVirtualBypassUrl(url) {
  return !url || typeof url !== 'string' || url.startsWith('data:') || url.startsWith('blob:');
}

function hasSpecialChars(str) {
  return typeof str === 'string' && (/[^\x00-\x7F]/.test(str) || str.includes('%'));
}

function isRpgmvHeader(buf) {
  return Boolean(
    buf &&
    buf.length >= 16 &&
    buf[0] === 0x52 &&
    buf[1] === 0x50 &&
    buf[2] === 0x47 &&
    buf[3] === 0x4D &&
    buf[4] === 0x56
  );
}

let activeGameDir = process.cwd();
let activeGameRootDir = null;
let activeIsMZ = false;
let cachedLegacySaveDirs = null;
let cachedTargetSaveDirs = null;
const MAX_PATH_CACHE_SIZE = 2048;
const resolvedPathCache = new Map();
const dirCache = new Map();

function invalidatePathCaches() {
  resolvedPathCache.clear();
  dirCache.clear();
}

function setActiveGameConfig(cfg = {}) {
  if (cfg.gameDir) {
    activeGameDir = cfg.gameDir;
    cachedLegacySaveDirs = null;
  }
  if (cfg.gameRootDir) {
    activeGameRootDir = cfg.gameRootDir;
    cachedTargetSaveDirs = null;
  }
  if (typeof cfg.isMZ === 'boolean') activeIsMZ = cfg.isMZ;
  resolvedPathCache.clear();
}

function setActiveGameDir(dir) {
  if (dir) {
    activeGameDir = dir;
    cachedLegacySaveDirs = null;
    resolvedPathCache.clear();
  }
}

function getActiveGameDir() {
  return activeGameDir;
}

function getActiveState() {
  return { activeGameDir, activeGameRootDir, activeIsMZ };
}

function getLegacySaveDirs() {
  if (!activeGameDir) return [];
  if (cachedLegacySaveDirs) return cachedLegacySaveDirs;
  const dirs = new Set();
  const d1 = path.resolve(activeGameDir, 'save');
  dirs.add(d1);
  try {
    const realGameDir = origRealPathSync.call(fs, activeGameDir);
    dirs.add(path.resolve(realGameDir, 'save'));
  } catch (e) {}
  try {
    dirs.add(origRealPathSync.call(fs, d1));
  } catch (e) {}
  cachedLegacySaveDirs = Array.from(dirs);
  return cachedLegacySaveDirs;
}

function getTargetSaveDirs() {
  if (!activeGameRootDir) return [];
  if (cachedTargetSaveDirs) return cachedTargetSaveDirs;
  const dirs = new Set();
  const d1 = path.resolve(activeGameRootDir, 'save');
  dirs.add(d1);
  try {
    const realRootDir = origRealPathSync.call(fs, activeGameRootDir);
    dirs.add(path.resolve(realRootDir, 'save'));
  } catch (e) {}
  try {
    dirs.add(origRealPathSync.call(fs, d1));
  } catch (e) {}
  cachedTargetSaveDirs = Array.from(dirs);
  return cachedTargetSaveDirs;
}

function redirectMzSavePath(targetPath) {
  if (!activeIsMZ || !activeGameRootDir || typeof targetPath !== 'string') return null;
  const targetSaveDir = path.resolve(activeGameRootDir, 'save');
  const normalized = path.resolve(activeGameDir, targetPath);

  const legacyDirs = getLegacySaveDirs();
  for (const legacyDir of legacyDirs) {
    if (normalized === legacyDir || normalized.startsWith(legacyDir + path.sep)) {
      const rel = path.relative(legacyDir, normalized);
      return path.join(targetSaveDir, rel);
    }
  }

  // Symlink canonical path matching (/roms vs /storage/roms)
  try {
    let canonical = normalized;
    if (origExistsSync.call(fs, normalized)) {
      canonical = origRealPathSync.call(fs, normalized);
    } else {
      const parent = path.dirname(normalized);
      if (origExistsSync.call(fs, parent)) {
        canonical = path.join(origRealPathSync.call(fs, parent), path.basename(normalized));
      }
    }
    for (const legacyDir of legacyDirs) {
      if (canonical === legacyDir || canonical.startsWith(legacyDir + path.sep)) {
        const rel = path.relative(legacyDir, canonical);
        return path.join(targetSaveDir, rel);
      }
    }
  } catch (e) {}

  return null;
}

function detectGameDirectory(baseDir, customGameDir) {
  if (customGameDir) {
    const custom = path.resolve(baseDir, customGameDir);
    if (origExistsSync.call(fs, path.join(custom, 'index.html')) || origExistsSync.call(fs, custom)) {
      return custom;
    }
  }
  const candidates = ['game', 'www'];
  for (const sub of candidates) {
    const candidatePath = path.join(baseDir, sub);
    if (origExistsSync.call(fs, path.join(candidatePath, 'index.html'))) {
      return candidatePath;
    }
  }
  if (origExistsSync.call(fs, path.join(baseDir, 'index.html'))) {
    return baseDir;
  }
  return path.join(baseDir, 'game'); // 기본값
}

function getCaseInsensitiveChild(parentDir, childName) {
  let cache = dirCache.get(parentDir);
  let entries;
  if (!cache) {
    try {
      entries = origReaddirSync.call(fs, parentDir);
      cache = new Map();
      for (const entry of entries) {
        cache.set(entry.toLowerCase(), entry);
        try { cache.set(entry.normalize('NFC').toLowerCase(), entry); } catch (e) {}
        try { cache.set(entry.normalize('NFD').toLowerCase(), entry); } catch (e) {}
      }
      dirCache.set(parentDir, cache);
      dirCache.set(parentDir + ':entries', entries);
    } catch (e) {
      return null;
    }
  } else {
    entries = dirCache.get(parentDir + ':entries') || [];
  }

  const lowerChild = (childName || '').toLowerCase();
  let match = cache.get(lowerChild);
  if (!match) {
    try { match = cache.get((childName || '').normalize('NFC').toLowerCase()); } catch (e) {}
  }
  if (!match) {
    try { match = cache.get((childName || '').normalize('NFD').toLowerCase()); } catch (e) {}
  }

  if (!match && entries && entries.length > 0) {
    const stripPunct = s => s.toLowerCase().replace(/[\s・･·•\-_.\u30FB\uFF65\u00B7\u2022]/g, '');
    const cleanChild = stripPunct(childName || '');
    for (const entry of entries) {
      if (stripPunct(entry) === cleanChild) {
        match = entry;
        break;
      }
    }
  }

  if (!match && entries && entries.length > 0) {
    const ext = path.extname(childName || '').toLowerCase();
    const base = path.basename(childName || '', ext).toLowerCase();
    const alphaMatch = base.match(/[a-z]{3,}/i);
    if (alphaMatch) {
      const keyword = alphaMatch[0].toLowerCase();
      const candidates = entries.filter(e => e.toLowerCase().endsWith(ext) && e.toLowerCase().includes(keyword));
      if (candidates.length === 1) {
        match = candidates[0];
      }
    }
  }

  if (!match && entries && entries.length > 0) {
    const ext = path.extname(childName || '').toLowerCase();
    const base = path.basename(childName || '', ext).toLowerCase();
    let altExts = [];
    if (ext === '.ogg') altExts = ['.m4a', '.rpgmvo', '.ogg_'];
    else if (ext === '.m4a') altExts = ['.ogg', '.rpgmvm', '.m4a_'];
    else if (ext === '.png') altExts = ['.rpgmvp', '.png_'];

    for (const altExt of altExts) {
      const altChild = (base + altExt).toLowerCase();
      const found = cache.get(altChild);
      if (found) {
        match = found;
        break;
      }
    }
  }

  return match || null;
}

function resolveCaseInsensitiveUncached(targetPath, baseDir = activeGameDir) {
  let normalizedTarget = path.resolve(baseDir, targetPath);
  if (!origExistsSync.call(fs, normalizedTarget) && targetPath.startsWith('/')) {
    const candidate = path.resolve(baseDir, targetPath.replace(/^\/+/, ''));
    if (origExistsSync.call(fs, candidate)) {
      normalizedTarget = candidate;
    }
  }

  if (!origExistsSync.call(fs, normalizedTarget)) {
    const stripped = targetPath.replace(/^[\/\\]?www[\/\\]/i, '');
    if (stripped !== targetPath) {
      const candidate = path.resolve(baseDir, stripped);
      if (origExistsSync.call(fs, candidate)) {
        normalizedTarget = candidate;
      } else {
        const wwwDir = path.resolve(baseDir, 'www');
        if (!origExistsSync.call(fs, wwwDir)) {
          normalizedTarget = candidate;
        }
      }
    }
  }

  if (activeIsMZ && activeGameRootDir) {
    const redirected = redirectMzSavePath(normalizedTarget);
    if (redirected) {
      if (origExistsSync.call(fs, redirected)) {
        return redirected;
      }
      if (origExistsSync.call(fs, normalizedTarget)) {
        return normalizedTarget;
      }
      return redirected;
    }

    const targetDirs = getTargetSaveDirs();
    for (const tDir of targetDirs) {
      if (normalizedTarget === tDir || normalizedTarget.startsWith(tDir + path.sep)) {
        if (!origExistsSync.call(fs, normalizedTarget)) {
          const rel = path.relative(tDir, normalizedTarget);
          const legacyFallback = path.join(activeGameDir, 'save', rel);
          if (origExistsSync.call(fs, legacyFallback)) {
            return legacyFallback;
          }
        }
        break;
      }
    }
  }

  if (origExistsSync.call(fs, normalizedTarget)) return normalizedTarget;

  const parentDir = path.dirname(normalizedTarget);
  if (origExistsSync.call(fs, parentDir)) {
    const filename = path.basename(normalizedTarget);
    const match = getCaseInsensitiveChild(parentDir, filename);
    if (match) return path.join(parentDir, match);
  }

  let realBase = baseDir;
  try { realBase = origRealPathSync.call(fs, baseDir); } catch (e) {}
  const normalizedBase = path.resolve(realBase);

  let compareTarget = normalizedTarget;
  try {
    let p = parentDir;
    while (p && p !== path.dirname(p)) {
      if (origExistsSync.call(fs, p)) {
        compareTarget = path.join(origRealPathSync.call(fs, p), path.relative(p, normalizedTarget));
        break;
      }
      p = path.dirname(p);
    }
  } catch (e) {}

  if (compareTarget.startsWith(normalizedBase)) {
    let current = normalizedBase;
    const rel = path.relative(normalizedBase, compareTarget);
    const relParts = rel.split(/[/\\]+/).filter(Boolean);
    for (const part of relParts) {
      const match = getCaseInsensitiveChild(current, part);
      if (!match) return targetPath;
      current = path.join(current, match);
    }
    return current;
  }
  return targetPath;
}

function resolveCaseInsensitive(targetPath, baseDir = activeGameDir) {
  if (!targetPath || typeof targetPath !== 'string') return targetPath;
  targetPath = targetPath.replace(/\uFEFF/g, '');
  const cacheKey = `${baseDir}\0${targetPath}`;
  if (resolvedPathCache.has(cacheKey)) {
    return resolvedPathCache.get(cacheKey);
  }
  const resolved = resolveCaseInsensitiveUncached(targetPath, baseDir);
  if (resolved && origExistsSync.call(fs, resolved)) {
    if (resolvedPathCache.size >= MAX_PATH_CACHE_SIZE) {
      const oldestKey = resolvedPathCache.keys().next().value;
      resolvedPathCache.delete(oldestKey);
    }
    resolvedPathCache.set(cacheKey, resolved);
  }
  return resolved;
}

function resolveGamePath(inputUrl, baseDir = activeGameDir) {
  if (!inputUrl || typeof inputUrl !== 'string') return null;
  if (inputUrl.startsWith('data:') || inputUrl.startsWith('blob:')) return null;
  let target = inputUrl.replace(/\uFEFF/g, '');
  if (target.startsWith('file://')) {
    try {
      target = new URL(target).pathname;
    } catch (e) {
      target = target.slice(7);
    }
  }
  try {
    target = decodeURIComponent(target);
  } catch (e) {}

  if (process.platform === 'win32' && target.startsWith('/') && target.length > 2 && target[2] === ':') {
    target = target.slice(1);
  }

  return resolveCaseInsensitive(target, baseDir);
}

module.exports = {
  detectGameDirectory,
  setActiveGameConfig,
  setActiveGameDir,
  getActiveGameDir,
  getActiveState,
  getCaseInsensitiveChild,
  resolveCaseInsensitive,
  resolveGamePath,
  redirectMzSavePath,
  getLegacySaveDirs,
  getTargetSaveDirs,
  invalidatePathCaches,
  isVirtualBypassUrl,
  hasSpecialChars,
  isRpgmvHeader,
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
  origUnlinkSync,
  origRealPathSync
};
