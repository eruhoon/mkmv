/**
 * mkmv On-Device Asset Cache & Space Reclamation Module
 *
 * 기능:
 * 1. 비동기 파일 트리 인덱스 (manifest.json)
 *    - 2회차 실행부터 대소문자/404 탐색을 디스크 syscall 없이 O(1) 메모리 조회
 * 2. 온디맨드 암호화 해제 캐시 (.rpgmvp/.png_ -> .png, .rpgmvo/.ogg_ -> .ogg, .rpgmvm/.m4a_ -> .m4a)
 *    - System.json encryptionKey 해시 기반 자동 무효화
 *    - fs.promises 비동기 저장으로 메인 스레드 프레임 드랍 방지
 * 3. 용량 회수 (LRU / TTL / 수동 비우기)
 *    - maxCacheSizeMB 상한 초과 시 가장 오래 안 쓴 파일부터 자동 정리
 *    - cacheTtlDays 경과 파일 자동 정리
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { createLogger } = require('../logger.js');
const {
  isRpgmvHeader,
  origExistsSync,
  origReadFileSync,
  origWriteFileSync,
  origMkdirSync,
  origReaddirSync,
  origRenameSync
} = require('./path-resolver.js');

const logger = createLogger('mkmv-cache');

const CACHE_DIR_NAME = '.mkmv-cache';
const MANIFEST_FILE_NAME = 'manifest.json';
const DECRYPTED_DIR_NAME = 'decrypted';

const ENCRYPTED_EXT_MAP = {
  '.rpgmvp': '.png',
  '.png_': '.png',
  '.rpgmvo': '.ogg',
  '.ogg_': '.ogg',
  '.rpgmvm': '.m4a',
  '.m4a_': '.m4a'
};

function getDecryptedExtension(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  const ext = path.extname(filePath).toLowerCase();
  return ENCRYPTED_EXT_MAP[ext] || null;
}

function normalizeManifestKey(relPath) {
  if (!relPath || typeof relPath !== 'string') return '';
  let clean = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  clean = clean.replace(/^www\//i, '');
  try {
    clean = clean.normalize('NFC');
  } catch (e) {}
  return clean.toLowerCase();
}

function decryptRpgmvBuffer(buf, encryptionKeyHex) {
  if (!isRpgmvHeader(buf)) return null;
  if (!encryptionKeyHex || typeof encryptionKeyHex !== 'string') return null;
  const keyClean = encryptionKeyHex.trim();
  if (keyClean.length < 32) return null;

  const keyBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const byteVal = parseInt(keyClean.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byteVal)) return null;
    keyBytes[i] = byteVal;
  }

  // RPG Maker MV/MZ: 16-byte RPGMV header + payload whose first 16 bytes are XORed with keyBytes
  const out = Buffer.from(buf.subarray(16));
  const limit = Math.min(16, out.length);
  for (let i = 0; i < limit; i++) {
    out[i] = out[i] ^ keyBytes[i];
  }
  return out;
}

function readEncryptionKeyHash(gameDir) {
  if (!gameDir) return { key: null, hash: null };
  const candidates = [
    path.join(gameDir, 'data', 'System.json'),
    path.join(gameDir, 'data', 'system.json')
  ];
  for (const sysPath of candidates) {
    try {
      if (origExistsSync.call(fs, sysPath)) {
        const raw = origReadFileSync.call(fs, sysPath, 'utf8').replace(/^\uFEFF/, '');
        const sys = JSON.parse(raw);
        if (sys && typeof sys.encryptionKey === 'string' && sys.encryptionKey.trim()) {
          const key = sys.encryptionKey.trim();
          const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
          return { key, hash };
        }
        return { key: null, hash: 'none' };
      }
    } catch (e) {}
  }
  return { key: null, hash: null };
}

function resolveCacheRoot(gameDir, gameRootDir) {
  const base = gameRootDir || gameDir;
  if (base) {
    const localCache = path.join(base, CACHE_DIR_NAME);
    try {
      if (!origExistsSync.call(fs, localCache)) {
        origMkdirSync.call(fs, localCache, { recursive: true });
      }
      return localCache;
    } catch (e) {}
  }
  const xdg = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  const gameHash = crypto.createHash('sha256').update(String(base || 'default')).digest('hex').slice(0, 12);
  const fallback = path.join(xdg, 'mkmv', gameHash);
  try {
    if (!origExistsSync.call(fs, fallback)) {
      origMkdirSync.call(fs, fallback, { recursive: true });
    }
  } catch (e) {}
  return fallback;
}

function createAssetCache(options = {}) {
  const {
    gameDir,
    gameRootDir,
    userOpt = {}
  } = options;

  const enabled = userOpt.assetCache !== false;
  if (!enabled || !gameDir) {
    return {
      enabled: false,
      lookupManifest: () => null,
      resolveCachedFile: () => null,
      writeDecryptedAsync: async () => false,
      decryptAndCacheBuffer: async () => null,
      getEncryptionKey: () => null,
      getCacheStats: async () => ({ fileCount: 0, totalBytes: 0 }),
      clearCache: async () => ({ removedFiles: 0, freedBytes: 0 }),
      pruneCache: async () => ({ removedFiles: 0, freedBytes: 0 }),
      scheduleBackgroundTasks: () => {}
    };
  }

  const cacheRoot = resolveCacheRoot(gameDir, gameRootDir);
  const manifestPath = path.join(cacheRoot, MANIFEST_FILE_NAME);
  const decryptedRoot = path.join(cacheRoot, DECRYPTED_DIR_NAME);

  const manifestMap = new Map();
  const pendingWrites = new Set();
  const touchedAt = new Map();
  let manifestLoaded = false;

  const { key: encryptionKey, hash: encryptionKeyHash } = readEncryptionKeyHash(gameDir);

  function loadManifestSync() {
    try {
      if (!origExistsSync.call(fs, manifestPath)) return false;
      const raw = origReadFileSync.call(fs, manifestPath, 'utf8');
      const data = JSON.parse(raw);
      if (!data || typeof data.files !== 'object') return false;

      if (encryptionKeyHash && data.encryptionKeyHash && data.encryptionKeyHash !== encryptionKeyHash) {
        logger.info('Encryption key changed; invalidating old decrypted cache');
        try {
          fs.rmSync(decryptedRoot, { recursive: true, force: true });
        } catch (e) {}
      }

      manifestMap.clear();
      for (const [k, v] of Object.entries(data.files)) {
        manifestMap.set(k, v);
      }
      manifestLoaded = true;
      logger.debug(`Loaded asset manifest (${manifestMap.size} entries)`);
      return true;
    } catch (e) {
      return false;
    }
  }

  loadManifestSync();

  function toRelGamePath(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') return null;
    let rel = inputPath;
    if (path.isAbsolute(inputPath)) {
      const normalizedGameDir = path.resolve(gameDir);
      const normalizedInput = path.resolve(inputPath);
      if (!normalizedInput.startsWith(normalizedGameDir + path.sep) && normalizedInput !== normalizedGameDir) {
        return null;
      }
      rel = path.relative(normalizedGameDir, normalizedInput);
    }
    return rel.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  function lookupManifest(targetPath) {
    if (!manifestLoaded || manifestMap.size === 0) return null;
    const rel = toRelGamePath(targetPath);
    if (!rel) return null;
    const key = normalizeManifestKey(rel);
    if (!key || key === 'save' || key.startsWith('save/')) return null;
    const actualRel = manifestMap.get(key);
    if (!actualRel) return null;
    return path.join(gameDir, actualRel);
  }

  function getDecryptedCachePath(targetPath) {
    const decExt = getDecryptedExtension(targetPath);
    if (!decExt) return null;
    const rel = toRelGamePath(targetPath);
    if (!rel) return null;
    const cleanRel = rel.replace(/^www\//i, '');
    const parsed = path.posix.parse(cleanRel);
    const outRel = parsed.dir ? path.posix.join(parsed.dir, parsed.name + decExt) : (parsed.name + decExt);
    return path.join(decryptedRoot, outRel);
  }

  function touchEntry(cacheFilePath) {
    const now = Date.now();
    const last = touchedAt.get(cacheFilePath) || 0;
    if (now - last < 60000) return;
    touchedAt.set(cacheFilePath, now);
    if (fs.promises && typeof fs.promises.utimes === 'function') {
      const sec = now / 1000;
      fs.promises.utimes(cacheFilePath, sec, sec).catch(() => {});
    }
  }

  function resolveCachedFile(targetPath) {
    const cacheFile = getDecryptedCachePath(targetPath);
    if (!cacheFile) return null;
    if (origExistsSync.call(fs, cacheFile)) {
      touchEntry(cacheFile);
      return cacheFile;
    }
    return null;
  }

  async function writeDecryptedAsync(targetPath, decryptedBuf) {
    if (!decryptedBuf || !decryptedBuf.length) return false;
    const cacheFile = getDecryptedCachePath(targetPath);
    if (!cacheFile || pendingWrites.has(cacheFile)) return false;
    if (origExistsSync.call(fs, cacheFile)) return true;

    pendingWrites.add(cacheFile);
    try {
      await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
      const tmp = `${cacheFile}.tmp.${Date.now()}`;
      await fs.promises.writeFile(tmp, decryptedBuf);
      await fs.promises.rename(tmp, cacheFile);
      touchedAt.set(cacheFile, Date.now());
      return true;
    } catch (e) {
      return false;
    } finally {
      pendingWrites.delete(cacheFile);
    }
  }

  async function decryptAndCacheBuffer(targetPath, encryptedBuf) {
    if (!encryptionKey || !encryptedBuf) return null;
    const dec = decryptRpgmvBuffer(encryptedBuf, encryptionKey);
    if (!dec) return null;
    await writeDecryptedAsync(targetPath, dec);
    return dec;
  }

  async function scanAndSaveManifest() {
    if (!fs.promises || typeof fs.promises.readdir !== 'function') return 0;
    const filesObj = Object.create(null);
    const skipDirs = new Set(['save', '.mkmv-cache', '.bak', 'node_modules']);

    async function walk(dir, relPrefix) {
      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (skipDirs.has(entry.name.toLowerCase())) continue;
          const nextRel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
          await walk(path.join(dir, entry.name), nextRel);
        } else if (entry.isFile()) {
          const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
          const key = normalizeManifestKey(rel);
          if (key && !filesObj[key]) {
            filesObj[key] = rel;
          }
        }
      }
    }

    await walk(gameDir, '');
    manifestMap.clear();
    const keys = Object.keys(filesObj);
    for (const k of keys) {
      manifestMap.set(k, filesObj[k]);
    }
    manifestLoaded = true;

    try {
      await fs.promises.mkdir(cacheRoot, { recursive: true });
      const tmp = `${manifestPath}.tmp.${Date.now()}`;
      const payload = JSON.stringify({
        version: 1,
        encryptionKeyHash: encryptionKeyHash || null,
        updatedAt: Date.now(),
        files: filesObj
      });
      await fs.promises.writeFile(tmp, payload, 'utf8');
      await fs.promises.rename(tmp, manifestPath);
      logger.debug(`Saved asset manifest (${keys.length} files)`);
    } catch (e) {
      logger.warn('Failed to write asset manifest:', e);
    }
    return keys.length;
  }

  async function collectDecryptedEntries() {
    const entries = [];
    if (!origExistsSync.call(fs, decryptedRoot)) return entries;

    async function walk(dir) {
      let items;
      try {
        items = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const item of items) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          await walk(full);
        } else if (item.isFile()) {
          try {
            const st = await fs.promises.stat(full);
            entries.push({ path: full, size: st.size, mtimeMs: st.mtimeMs });
          } catch (e) {}
        }
      }
    }

    await walk(decryptedRoot);
    return entries;
  }

  async function pruneCache(pruneOpts = {}) {
    const maxMB = Number(pruneOpts.maxCacheSizeMB ?? userOpt.maxCacheSizeMB ?? 256);
    const ttlDays = Number(pruneOpts.cacheTtlDays ?? userOpt.cacheTtlDays ?? 30);
    const maxBytes = maxMB > 0 ? maxMB * 1024 * 1024 : Infinity;
    const ttlCutoffMs = ttlDays > 0 ? Date.now() - (ttlDays * 86400 * 1000) : 0;

    const entries = await collectDecryptedEntries();
    if (entries.length === 0) return { removedFiles: 0, freedBytes: 0 };

    let removedFiles = 0;
    let freedBytes = 0;
    const remaining = [];

    for (const entry of entries) {
      if (ttlCutoffMs > 0 && entry.mtimeMs < ttlCutoffMs) {
        try {
          await fs.promises.unlink(entry.path);
          removedFiles++;
          freedBytes += entry.size;
          continue;
        } catch (e) {}
      }
      remaining.push(entry);
    }

    let totalBytes = remaining.reduce((sum, e) => sum + e.size, 0);
    if (totalBytes > maxBytes) {
      remaining.sort((a, b) => a.mtimeMs - b.mtimeMs); // LRU: oldest first
      for (const entry of remaining) {
        if (totalBytes <= maxBytes) break;
        try {
          await fs.promises.unlink(entry.path);
          totalBytes -= entry.size;
          removedFiles++;
          freedBytes += entry.size;
        } catch (e) {}
      }
    }

    if (removedFiles > 0) {
      logger.info(`Pruned ${removedFiles} cached assets (freed ${(freedBytes / (1024 * 1024)).toFixed(2)} MB)`);
    }
    return { removedFiles, freedBytes };
  }

  async function getCacheStats() {
    const entries = await collectDecryptedEntries();
    const totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
    return { fileCount: entries.length, totalBytes };
  }

  async function clearCache() {
    const stats = await getCacheStats();
    try {
      await fs.promises.rm(decryptedRoot, { recursive: true, force: true });
    } catch (e) {}
    try {
      await fs.promises.rm(manifestPath, { force: true });
    } catch (e) {}
    manifestMap.clear();
    manifestLoaded = false;
    touchedAt.clear();
    logger.info(`Cleared asset cache (${stats.fileCount} files)`);
    return { removedFiles: stats.fileCount, freedBytes: stats.totalBytes };
  }

  function scheduleBackgroundTasks() {
    const scanTimer = setTimeout(() => {
      if (!manifestLoaded) {
        scanAndSaveManifest().catch(() => {});
      }
      pruneCache().catch(() => {});
    }, 3000);
    if (scanTimer && typeof scanTimer.unref === 'function') scanTimer.unref();
  }

  return {
    enabled: true,
    cacheRoot,
    decryptedRoot,
    manifestPath,
    getEncryptionKey: () => encryptionKey,
    lookupManifest,
    resolveCachedFile,
    getDecryptedCachePath,
    writeDecryptedAsync,
    decryptAndCacheBuffer,
    scanAndSaveManifest,
    pruneCache,
    getCacheStats,
    clearCache,
    scheduleBackgroundTasks
  };
}

module.exports = {
  createAssetCache,
  decryptRpgmvBuffer,
  getDecryptedExtension,
  normalizeManifestKey
};
