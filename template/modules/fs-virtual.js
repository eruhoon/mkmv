/**
 * mkmv Virtual File System & Save Protection Module
 *
 * 기능:
 * 1. Linux ext4 파일시스템 대소문자/유니코드 불일치 대응 (가상 파일시스템)
 *    - getCaseInsensitiveChild: 대소문자, NFC/NFD 정규화, 일본어 특수문자, 확장자 교차 탐색
 *    - resolveCaseInsensitive, resolveGamePath
 * 2. Node.js fs 가상화 패치
 *    - fs.existsSync, fs.readFileSync, fs.statSync, fs.readFile
 *    - lng.txt 부재 시 기본값 'ko' 자동 생성
 *    - 0바이트 손상 세이브 파일 자동 복구 (.bak)
 *    - fs.writeFileSync: 원자적 쓰기(Atomic Save: .tmp ➡️ fsync ➡️ rename) 및 .bak 자동 백업
 * 3. Chromium C++ FileURLLoaderFactory 버그 우회
 *    - setupUniversalXhrRecovery: XMLHttpRequest 및 window.fetch 유니코드 직접 로드
 * 4. 알만툴 DataManager JSON 데이터 파일 유니코드 직접 로드
 *    - setupDataManagerRecovery
 * 5. 게임 디렉토리 자동 감지 (detectGameDirectory)
 */

const path = require('path');
const fs = require('fs');
const { createLogger } = require('./logger.js');
const logger = createLogger('mkmv-vfs');

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

let activeGameDir = process.cwd();
let activeGameRootDir = null;
let activeIsMZ = false;

function setActiveGameConfig(cfg = {}) {
  if (cfg.gameDir) activeGameDir = cfg.gameDir;
  if (cfg.gameRootDir) activeGameRootDir = cfg.gameRootDir;
  if (typeof cfg.isMZ === 'boolean') activeIsMZ = cfg.isMZ;
}

function setActiveGameDir(dir) {
  if (dir) activeGameDir = dir;
}

function getActiveGameDir() {
  return activeGameDir;
}

function getLegacySaveDirs() {
  if (!activeGameDir) return [];
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
  return Array.from(dirs);
}

function getTargetSaveDirs() {
  if (!activeGameRootDir) return [];
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
  return Array.from(dirs);
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

function detectGameDirectory(baseDir) {
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

// Linux ext4 파일시스템 대소문자 불일치 대응
const dirCache = new Map();

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

  // 1. 특수문자(일본어 점, 반각/전각 점, 언더바, 대시 등) 무시 정규화 비교
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

  // 2. 동일 확장자 내에서 알파벳 키워드 부분 일치 검사 (예: Skip.png, Auto.png)
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

  // 3. 확장자가 다른 동일 이름 미디어 파일 (.ogg <-> .m4a, .png <-> .rpgmvp / .png_)
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

function resolveCaseInsensitive(targetPath, baseDir = activeGameDir) {
  if (!targetPath || typeof targetPath !== 'string') return targetPath;
  targetPath = targetPath.replace(/\uFEFF/g, '');
  let normalizedTarget = path.resolve(baseDir, targetPath);
  if (!origExistsSync.call(fs, normalizedTarget) && targetPath.startsWith('/')) {
    const candidate = path.resolve(baseDir, targetPath.replace(/^\/+/, ''));
    if (origExistsSync.call(fs, candidate)) {
      normalizedTarget = candidate;
    }
  }

  // www/ 하드코딩 플러그인 호환: game 폴더 환경에서 www/ 접두사 제거 매핑
  if (!origExistsSync.call(fs, normalizedTarget)) {
    const stripped = targetPath.replace(/^[\/\\]?www[\/\\]/i, '');
    if (stripped !== targetPath) {
      const candidate = path.resolve(baseDir, stripped);
      if (origExistsSync.call(fs, candidate)) {
        normalizedTarget = candidate;
      }
    }
  }

  // MZ 엔진 전용: game/save/... 접근 시 포트 루트 save/ 폴더 우선 탐색
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

    // targetSaveDir에 직접 접근했으나 없는 경우, legacySaveDir에 존재하는지 폴백 검사
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

  // 1. 단일 파일 레벨 빠른 대소문자/유니코드 매칭
  const parentDir = path.dirname(normalizedTarget);
  if (origExistsSync.call(fs, parentDir)) {
    const filename = path.basename(normalizedTarget);
    const match = getCaseInsensitiveChild(parentDir, filename);
    if (match) return path.join(parentDir, match);
  }

  // 2. 심볼릭 링크 및 다단계 경로 계층 탐색
  let realBase = baseDir;
  try { realBase = fs.realpathSync(baseDir); } catch (e) {}
  const normalizedBase = path.resolve(realBase);

  let compareTarget = normalizedTarget;
  try {
    let p = parentDir;
    while (p && p !== path.dirname(p)) {
      if (origExistsSync.call(fs, p)) {
        compareTarget = path.join(fs.realpathSync(p), path.relative(p, normalizedTarget));
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

// 게임 내 URL을 디스크 절대 경로로 정규화
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

// Chromium C++ FileURLLoaderFactory 버그 대응: 유니코드/특수문자 파일의 XMLHttpRequest 및 fetch 직접 복구
function setupUniversalXhrRecovery(baseDir = activeGameDir) {
  if (typeof XMLHttpRequest === 'undefined') return;
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  function fulfillXhr(targetXhr, resolvedPath) {
    try {
      const isArrayBuffer = targetXhr.responseType === 'arraybuffer';
      const isJson = targetXhr.responseType === 'json';
      const isBlob = targetXhr.responseType === 'blob';

      let responseData;
      let responseText = '';

      if (isArrayBuffer) {
        const buf = origReadFileSync.call(fs, resolvedPath);
        responseData = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } else if (isBlob) {
        const buf = origReadFileSync.call(fs, resolvedPath);
        responseData = new Blob([buf]);
      } else {
        responseText = origReadFileSync.call(fs, resolvedPath, 'utf8').replace(/^\uFEFF/, '');
        if (isJson) {
          try {
            responseData = JSON.parse(responseText);
          } catch (e) {
            responseData = null;
          }
        } else {
          responseData = responseText;
        }
      }

      Object.defineProperty(targetXhr, 'readyState', { value: 4, writable: false, configurable: true });
      Object.defineProperty(targetXhr, 'status', { value: 200, writable: false, configurable: true });
      Object.defineProperty(targetXhr, 'statusText', { value: 'OK', writable: false, configurable: true });
      Object.defineProperty(targetXhr, 'response', { value: responseData, writable: false, configurable: true });
      if (!isArrayBuffer && !isBlob) {
        Object.defineProperty(targetXhr, 'responseText', { value: responseText, writable: false, configurable: true });
      }

      if (typeof targetXhr.onreadystatechange === 'function') {
        targetXhr.onreadystatechange();
      }
      targetXhr.dispatchEvent(new Event('readystatechange'));

      if (typeof targetXhr.onload === 'function') {
        targetXhr.onload();
      }
      targetXhr.dispatchEvent(new ProgressEvent('load'));

      if (typeof targetXhr.onloadend === 'function') {
        targetXhr.onloadend();
      }
      targetXhr.dispatchEvent(new ProgressEvent('loadend'));
    } catch (err) {
      logger.error('XHR direct fulfill error:', err);
      if (typeof targetXhr.onerror === 'function') {
        targetXhr.onerror();
      }
      targetXhr.dispatchEvent(new ProgressEvent('error'));
    }
  }

  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    this._mkmvMethod = (method || 'GET').toUpperCase();
    this._mkmvUrl = url;
    this._mkmvAsync = async !== false;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const url = this._mkmvUrl;
    const method = this._mkmvMethod;

    if (method === 'GET' && typeof url === 'string' && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:') && !url.startsWith('blob:')) {
      const resolved = resolveGamePath(url, baseDir);
      const exists = resolved && origExistsSync.call(fs, resolved);
      const hasSpecial = /[^\x00-\x7F]/.test(url) || (resolved && /[^\x00-\x7F]/.test(resolved)) || url.includes('%');

      if (hasSpecial && exists) {
        if (this._mkmvAsync === false) {
          // 동기(Sync) XHR: send() 반환 즉시 결과가 준비되어야 하므로 즉시 채움
          fulfillXhr(this, resolved);
          return;
        }
        // 비동기(Async) XHR: 표준 비동기 이벤트 루프 시뮬레이션
        const self = this;
        setTimeout(() => {
          fulfillXhr(self, resolved);
        }, 0);
        return;
      }
    }

    return origSend.apply(this, arguments);
  };

  if (typeof window !== 'undefined' && window.fetch) {
    const origFetch = window.fetch;
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:') && !url.startsWith('blob:')) {
        const resolved = resolveGamePath(url, baseDir);
        const exists = resolved && origExistsSync.call(fs, resolved);
        const hasSpecial = /[^\x00-\x7F]/.test(url) || (resolved && /[^\x00-\x7F]/.test(resolved)) || url.includes('%');
        if (hasSpecial && exists) {
          try {
            const buf = origReadFileSync.call(fs, resolved);
            return Promise.resolve(new Response(buf, { status: 200, statusText: 'OK' }));
          } catch (e) {}
        }
      }
      return origFetch.apply(this, arguments);
    };
  }

  logger.debug('Universal XHR & Fetch Unicode recovery installed');
}

// Node.js fs 가상화 패치
function patchFs(baseDir = activeGameDir) {
  if (fs._mkmvFsHooked) return;
  fs._mkmvFsHooked = true;

  fs.existsSync = function(p) {
    try {
      return origExistsSync.call(fs, resolveCaseInsensitive(p, baseDir));
    } catch (e) {
      return origExistsSync.call(fs, p);
    }
  };

  fs.readFileSync = function(p, options) {
    const resolved = resolveCaseInsensitive(p, baseDir);
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

    // 0바이트 손상 세이브 파일 자동 복구 (.bak)
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
    return origStatSync.call(fs, resolveCaseInsensitive(p, baseDir), options);
  };

  fs.readFile = function(p, ...args) {
    return origReadFile.call(fs, resolveCaseInsensitive(p, baseDir), ...args);
  };

  // 세이브 파일 파손 방지 (원자적 쓰기 + 물리 SD 카드 fsync 플러시 + .bak 서브폴더 자동 백업)
  fs.writeFileSync = function(p, data, options) {
    let resolvedPath = resolveCaseInsensitive(p, baseDir);

    // MZ 엔진 전용: game/save/... 저장 시 포트 루트 save/ 로 리다이렉트
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
        return;
      } catch (err) {
        logger.warn('Atomic save failed, falling back to direct write:', err);
      }
    }
    return origWriteFileSync.call(fs, resolvedPath, data, options);
  };

  fs.renameSync = function(oldPath, newPath) {
    let resolvedOld = resolveCaseInsensitive(oldPath, baseDir);
    let resolvedNew = resolveCaseInsensitive(newPath, baseDir);
    if (activeIsMZ && activeGameRootDir) {
      resolvedOld = redirectMzSavePath(resolvedOld) || resolvedOld;
      resolvedNew = redirectMzSavePath(resolvedNew) || resolvedNew;
    }
    return origRenameSync.call(fs, resolvedOld, resolvedNew);
  };

  fs.readdirSync = function(p, options) {
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
    return origReaddirSync.call(fs, resolveCaseInsensitive(p, baseDir), options);
  };

  fs.mkdirSync = function(p, options) {
    let resolved = resolveCaseInsensitive(p, baseDir);
    if (activeIsMZ && activeGameRootDir) {
      const redirected = redirectMzSavePath(resolved);
      if (redirected) {
        resolved = redirected;
      }
    }
    return origMkdirSync.call(fs, resolved, options);
  };

  fs.unlinkSync = function(p) {
    let resolved = resolveCaseInsensitive(p, baseDir);
    if (activeIsMZ && activeGameRootDir) {
      resolved = redirectMzSavePath(resolved) || resolved;
    }
    return origUnlinkSync.call(fs, resolved);
  };
}

// 알만툴 DataManager JSON 데이터 파일 유니코드 복구
function setupDataManagerRecovery(baseDir = activeGameDir) {
  if (typeof window === 'undefined') return;

  let cleanupTimer = null;
  const hookTimer = setInterval(() => {
    if (window.DataManager && typeof window.DataManager.loadDataFile === 'function') {
      if (!window.DataManager._mkmvDataHooked) {
        window.DataManager._mkmvDataHooked = true;
        const origLoadDataFile = window.DataManager.loadDataFile;
        window.DataManager.loadDataFile = function(name, src) {
          const dataUrl = 'data/' + src;
          const resolved = resolveGamePath(dataUrl, baseDir);
          const exists = resolved && origExistsSync.call(fs, resolved);
          const hasSpecial = /[^\x00-\x7F]/.test(src || '') || (resolved && /[^\x00-\x7F]/.test(resolved));

          if (hasSpecial && exists) {
            try {
              logger.verbose(`Direct loading Unicode DataFile via Node.js fs: ${src}`);
              const content = origReadFileSync.call(fs, resolved, 'utf8');
              window[name] = JSON.parse(content.replace(/^\uFEFF/, ''));
              DataManager.onLoad(window[name]);
              return;
            } catch (e) {
              logger.error('Direct DataFile load error:', e);
            }
          }
          return origLoadDataFile.apply(this, arguments);
        };
        clearInterval(hookTimer);
        if (cleanupTimer) clearTimeout(cleanupTimer);
        logger.debug('DataManager unicode recovery hook installed successfully');
      }
    }
  }, 50);
  cleanupTimer = setTimeout(() => clearInterval(hookTimer), 30000);
  if (cleanupTimer && cleanupTimer.unref) cleanupTimer.unref();
  if (hookTimer && hookTimer.unref) hookTimer.unref();
}

// 알만툴 MZ 세이브 경로를 포트 루트 save/ 로 일원화 및 레거시 세이브 마이그레이션
function setupMzSaveManager(options = {}) {
  const gameRootDir = options.gameRootDir || activeGameRootDir;
  const gameDir = options.gameDir || activeGameDir;
  if (!gameRootDir || !gameDir) return;

  const targetSaveDir = path.resolve(gameRootDir, 'save');
  const legacySaveDir = path.resolve(gameDir, 'save');

  // 1. 포트 루트 save 디렉터리 및 레거시 save 디렉터리 보장
  try {
    if (!origExistsSync.call(fs, targetSaveDir)) {
      origMkdirSync.call(fs, targetSaveDir, { recursive: true });
    }
    if (!origExistsSync.call(fs, legacySaveDir)) {
      origMkdirSync.call(fs, legacySaveDir, { recursive: true });
    }
  } catch (e) {}

  // 2. 기존 game/save -> 루트 save 안전 마이그레이션 (기존 세이브 유실 방지)
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
                  // global.rmmzsave는 더 큰 파일(세이브 슬롯 정보가 보존된 파일) 우선
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

  // 3. StorageManager 패치 함수
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

  // Object.defineProperty로 즉각 가로채기 (0ms 레이스 컨디션 방지)
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

  let smTimer = setInterval(() => {
    if (window.StorageManager && typeof window.StorageManager.fileDirectoryPath === 'function') {
      patchSM(window.StorageManager);
      if (window.StorageManager._mkmvSaveHooked) {
        clearInterval(smTimer);
      }
    }
  }, 20);
  const cleanupTimer = setTimeout(() => clearInterval(smTimer), 30000);
  if (cleanupTimer && cleanupTimer.unref) cleanupTimer.unref();
  if (smTimer && smTimer.unref) smTimer.unref();
}

function setupVirtualFs(options = {}) {
  const { gameDir, gameRootDir, isMZ } = options;
  if (gameDir) setActiveGameDir(gameDir);
  if (gameRootDir || typeof isMZ === 'boolean') {
    setActiveGameConfig({ gameDir, gameRootDir, isMZ });
  }

  patchFs(activeGameDir);
  setupUniversalXhrRecovery(activeGameDir);
  setupDataManagerRecovery(activeGameDir);

  if (activeIsMZ && activeGameRootDir) {
    setupMzSaveManager({ gameRootDir: activeGameRootDir, gameDir: activeGameDir });
  }
}

module.exports = {
  detectGameDirectory,
  setupVirtualFs,
  setupMzSaveManager,
  setActiveGameConfig,
  setActiveGameDir,
  getActiveGameDir,
  getCaseInsensitiveChild,
  resolveCaseInsensitive,
  resolveGamePath,
  setupUniversalXhrRecovery,
  patchFs,
  setupDataManagerRecovery,
  redirectMzSavePath,
  getLegacySaveDirs,
  getTargetSaveDirs,
  // 원본 fs 백업 메서드 노출
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
