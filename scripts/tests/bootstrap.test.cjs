const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { waitForCondition, resolveGameRootDir } = require('../../template/modules/bootstrap.js');
const {
  isVirtualBypassUrl,
  hasSpecialChars,
  isRpgmvHeader,
  resolveCaseInsensitive,
  invalidatePathCaches,
  detectGameDirectory
} = require('../../template/modules/fs-virtual.js');

test('resolveGameRootDir prioritizes --game-dir CLI flag over env and runtimeDir', () => {
  const runtimeDir = path.resolve('/opt/mkmv');
  assert.equal(resolveGameRootDir(runtimeDir, ['node', 'main.js'], {}), runtimeDir);
  assert.equal(
    resolveGameRootDir(runtimeDir, ['node', 'main.js'], { MKMV_GAME_DIR: '/games/env-game' }),
    '/games/env-game'
  );
  assert.equal(
    resolveGameRootDir(runtimeDir, ['node', 'main.js', '--game-dir=./my-game'], { MKMV_GAME_DIR: '/games/env-game' }),
    path.resolve('./my-game')
  );
});

test('waitForCondition invokes onReady immediately when predicate is true', () => {
  let called = 0;
  const stop = waitForCondition(() => true, () => { called++; }, { intervalMs: 10, timeoutMs: 100 });
  assert.equal(called, 1);
  assert.equal(typeof stop, 'function');
  stop();
});

test('waitForCondition polls until predicate becomes true and stops cleanly', async () => {
  let ready = false;
  let called = 0;
  setTimeout(() => { ready = true; }, 25);
  await new Promise((resolve) => {
    waitForCondition(
      () => ready,
      () => {
        called++;
        resolve();
      },
      { intervalMs: 10, timeoutMs: 500, runImmediately: false }
    );
  });
  assert.equal(called, 1);
});

test('fs-virtual shared resource helpers classify URLs, special chars, and RPGMV headers', () => {
  assert.equal(isVirtualBypassUrl(''), true);
  assert.equal(isVirtualBypassUrl(null), true);
  assert.equal(isVirtualBypassUrl('data:image/png;base64,AAA'), true);
  assert.equal(isVirtualBypassUrl('blob:file:///123'), true);
  assert.equal(isVirtualBypassUrl('img/pictures/test.png'), false);

  assert.equal(hasSpecialChars('img/pictures/actor1.png'), false);
  assert.equal(hasSpecialChars('img/pictures/한글.png'), true);
  assert.equal(hasSpecialChars('img/pictures/%EA%B0%80.png'), true);

  const rpgmvBuf = Buffer.concat([Buffer.from('RPGMV', 'ascii'), Buffer.alloc(16)]);
  assert.equal(isRpgmvHeader(rpgmvBuf), true);
  assert.equal(isRpgmvHeader(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0])), false);
});

test('detectGameDirectory supports customGameDir and resolveCaseInsensitive caches hits', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-bootstrap-test-'));
  try {
    const customDir = path.join(tmpDir, 'custom_game');
    fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(path.join(customDir, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(customDir, 'TestFile.txt'), 'hello');

    assert.equal(detectGameDirectory(tmpDir, 'custom_game'), customDir);

    invalidatePathCaches();
    const first = resolveCaseInsensitive('www/testfile.txt', customDir);
    assert.equal(fs.existsSync(first), true);
    assert.equal(first.toLowerCase(), path.join(customDir, 'TestFile.txt').toLowerCase());
    const second = resolveCaseInsensitive('www/testfile.txt', customDir);
    assert.equal(second, first);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
