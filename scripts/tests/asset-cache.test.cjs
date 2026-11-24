const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  createAssetCache,
  decryptRpgmvBuffer
} = require('../../template/modules/vfs/asset-cache.js');
const {
  setAssetCache,
  resolveCaseInsensitive,
  invalidatePathCaches
} = require('../../template/modules/fs-virtual.js');

function makeEncryptedRpgmv(payloadBuf, keyHex) {
  const header = Buffer.from('5250474d560000000003010000000000', 'hex'); // 16-byte RPGMV header
  const enc = Buffer.from(payloadBuf);
  for (let i = 0; i < Math.min(16, enc.length); i++) {
    const k = parseInt(keyHex.slice(i * 2, i * 2 + 2), 16);
    enc[i] = enc[i] ^ k;
  }
  return Buffer.concat([header, enc]);
}

test('decryptRpgmvBuffer strips 16-byte header and XORs first 16 payload bytes', () => {
  const keyHex = '00112233445566778899aabbccddeeff';
  const original = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8, 99, 100]);
  const encrypted = makeEncryptedRpgmv(original, keyHex);

  const decrypted = decryptRpgmvBuffer(encrypted, keyHex);
  assert.ok(Buffer.isBuffer(decrypted));
  assert.deepEqual(decrypted, original);
});

test('createAssetCache scans manifest and accelerates path-resolver lookup', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-cache-manifest-'));
  const gameDir = path.join(rootDir, 'game');
  fs.mkdirSync(path.join(gameDir, 'img', 'pictures'), { recursive: true });
  fs.mkdirSync(path.join(gameDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(gameDir, 'data', 'System.json'), JSON.stringify({ encryptionKey: '00112233445566778899aabbccddeeff' }));
  const targetPng = path.join(gameDir, 'img', 'pictures', 'Heroine_Cg.png');
  fs.writeFileSync(targetPng, 'png-bytes');

  try {
    const cache = createAssetCache({ gameDir, gameRootDir: rootDir, userOpt: { assetCache: true } });
    const count = await cache.scanAndSaveManifest();
    assert.ok(count >= 2);
    assert.equal(fs.existsSync(path.join(rootDir, '.mkmv-cache', 'manifest.json')), true);

    // Re-load from saved manifest on second boot
    const cache2 = createAssetCache({ gameDir, gameRootDir: rootDir, userOpt: { assetCache: true } });
    setAssetCache(cache2);
    invalidatePathCaches();

    const resolved = resolveCaseInsensitive('www/img/pictures/heroine_cg.png', gameDir);
    assert.equal(resolved.toLowerCase(), targetPng.toLowerCase());
  } finally {
    setAssetCache(null);
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('createAssetCache decrypts on demand, prunes by TTL/LRU, and clears cache', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-cache-lru-'));
  const gameDir = path.join(rootDir, 'game');
  const keyHex = '00112233445566778899aabbccddeeff';
  fs.mkdirSync(path.join(gameDir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(gameDir, 'img', 'pictures'), { recursive: true });
  fs.writeFileSync(path.join(gameDir, 'data', 'System.json'), JSON.stringify({ encryptionKey: keyHex }));

  try {
    const cache = createAssetCache({
      gameDir,
      gameRootDir: rootDir,
      userOpt: { assetCache: true, maxCacheSizeMB: 0.0001, cacheTtlDays: 30 } // ~100 bytes cap
    });

    const payloadA = Buffer.alloc(80, 0x41);
    const payloadB = Buffer.alloc(80, 0x42);
    const decA = await cache.decryptAndCacheBuffer('img/pictures/a.rpgmvp', makeEncryptedRpgmv(payloadA, keyHex));
    assert.deepEqual(decA, payloadA);

    const cachedA = cache.resolveCachedFile('img/pictures/a.rpgmvp');
    assert.ok(cachedA && fs.existsSync(cachedA));

    // Make A older than B
    const oldTime = (Date.now() - 10000) / 1000;
    fs.utimesSync(cachedA, oldTime, oldTime);

    await cache.decryptAndCacheBuffer('img/pictures/b.rpgmvp', makeEncryptedRpgmv(payloadB, keyHex));
    const statsBefore = await cache.getCacheStats();
    assert.equal(statsBefore.fileCount, 2);

    // LRU prune should remove older A and keep B
    const pruned = await cache.pruneCache();
    assert.equal(pruned.removedFiles, 1);
    assert.equal(cache.resolveCachedFile('img/pictures/a.rpgmvp'), null);
    assert.ok(cache.resolveCachedFile('img/pictures/b.rpgmvp'));

    // Clear all
    const cleared = await cache.clearCache();
    assert.equal(cleared.removedFiles, 1);
    const statsAfter = await cache.getCacheStats();
    assert.equal(statsAfter.fileCount, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
