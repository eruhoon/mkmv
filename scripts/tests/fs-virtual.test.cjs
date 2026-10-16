const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  detectGameDirectory,
  resolveCaseInsensitive,
  resolveGamePath,
  getCaseInsensitiveChild,
  setupVirtualFs
} = require('../../template/modules/fs-virtual.js');

test('detectGameDirectory prioritizes game folder and supports legacy www folder', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-test-'));

  // 1. Default fallback when neither exists should be 'game'
  assert.equal(detectGameDirectory(tmpDir), path.join(tmpDir, 'game'));

  // 2. Legacy www folder detected when index.html is in www
  const wwwDir = path.join(tmpDir, 'www');
  fs.mkdirSync(wwwDir);
  fs.writeFileSync(path.join(wwwDir, 'index.html'), '<html></html>');
  assert.equal(detectGameDirectory(tmpDir), wwwDir);

  // 3. Game folder prioritized when both game and www exist
  const gameDir = path.join(tmpDir, 'game');
  fs.mkdirSync(gameDir);
  fs.writeFileSync(path.join(gameDir, 'index.html'), '<html></html>');
  assert.equal(detectGameDirectory(tmpDir), gameDir);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveCaseInsensitive strips www prefix for game directory compatibility', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-test-vfs-'));
  const imgDir = path.join(tmpDir, 'img');
  fs.mkdirSync(imgDir);
  fs.writeFileSync(path.join(imgDir, 'hero.png'), 'image-bytes');

  // Plugin requests www/img/hero.png when cwd/baseDir is game folder
  const resolved = resolveCaseInsensitive('www/img/hero.png', tmpDir);
  assert.equal(resolved, path.join(imgDir, 'hero.png'));

  // Also test /www/img/hero.png
  const resolvedSlash = resolveCaseInsensitive('/www/img/hero.png', tmpDir);
  assert.equal(resolvedSlash, path.join(imgDir, 'hero.png'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('getCaseInsensitiveChild finds file regardless of casing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-test-case-'));
  const targetFile = path.join(tmpDir, 'TestFile.PNG');
  fs.writeFileSync(targetFile, 'data');

  const match = getCaseInsensitiveChild(tmpDir, 'testfile.png');
  assert.equal(match, 'TestFile.PNG');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveGamePath handles file:// URLs and encoded characters', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-test-url-'));
  const targetFile = path.join(tmpDir, '한글파일.txt');
  fs.writeFileSync(targetFile, 'content');

  const resolved = resolveGamePath('file://' + encodeURIComponent(targetFile), tmpDir);
  assert.ok(resolved);
  assert.equal(path.basename(resolved), '한글파일.txt');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('setupVirtualFs enables atomic save on writeFileSync for save files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-test-save-'));
  setupVirtualFs({ gameDir: tmpDir });

  const saveFile = path.join(tmpDir, 'file1.rpgsave');
  fs.writeFileSync(saveFile, 'save-data-1', 'utf8');

  assert.equal(fs.existsSync(saveFile), true);
  assert.equal(fs.readFileSync(saveFile, 'utf8'), 'save-data-1');

  // Updating save file should create a backup in .bak
  fs.writeFileSync(saveFile, 'save-data-2', 'utf8');
  assert.equal(fs.readFileSync(saveFile, 'utf8'), 'save-data-2');

  const bakFile = path.join(tmpDir, '.bak', 'file1.rpgsave.bak');
  assert.equal(fs.existsSync(bakFile), true);
  assert.equal(fs.readFileSync(bakFile, 'utf8'), 'save-data-1');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('setupVirtualFs with isMZ redirects save writes and migrates legacy saves', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-test-mz-root-'));
  const gameDir = path.join(rootDir, 'game');
  const legacySaveDir = path.join(gameDir, 'save');
  const rootSaveDir = path.join(rootDir, 'save');

  fs.mkdirSync(legacySaveDir, { recursive: true });

  // 1. Create a legacy save file in game/save/
  const legacyFile = path.join(legacySaveDir, 'file0.rmmzsave');
  fs.writeFileSync(legacyFile, 'legacy-autosave-data', 'utf8');

  // 2. Initialize virtual fs with isMZ = true
  setupVirtualFs({ gameDir, gameRootDir: rootDir, isMZ: true });

  // 3. Verify legacy file was migrated to root save/
  const migratedFile = path.join(rootSaveDir, 'file0.rmmzsave');
  assert.equal(fs.existsSync(migratedFile), true, 'legacy file should be migrated to root save/');
  assert.equal(fs.readFileSync(migratedFile, 'utf8'), 'legacy-autosave-data');

  // 4. Verify writing to game/save/ redirects to root save/
  const newSaveTarget = path.join(legacySaveDir, 'file1.rmmzsave');
  fs.writeFileSync(newSaveTarget, 'new-slot1-data', 'utf8');

  const rootSlot1 = path.join(rootSaveDir, 'file1.rmmzsave');
  assert.equal(fs.existsSync(rootSlot1), true, 'new save should be redirected to root save/');
  assert.equal(fs.readFileSync(rootSlot1, 'utf8'), 'new-slot1-data');

  // 5. Verify resolveCaseInsensitive / reading game/save/ resolves from root save/
  assert.equal(fs.existsSync(newSaveTarget), true, 'should resolve existence via root save fallback');
  assert.equal(fs.readFileSync(newSaveTarget, 'utf8'), 'new-slot1-data');

  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('setupVirtualFs in MV mode does not redirect to root save', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-test-mv-root-'));
  const gameDir = path.join(rootDir, 'www');
  const wwwSaveDir = path.join(gameDir, 'save');
  const rootSaveDir = path.join(rootDir, 'save');

  fs.mkdirSync(wwwSaveDir, { recursive: true });

  // MV mode: isMZ = false
  setupVirtualFs({ gameDir, gameRootDir: rootDir, isMZ: false });

  const mvSaveFile = path.join(wwwSaveDir, 'file1.rpgsave');
  fs.writeFileSync(mvSaveFile, 'mv-save-data', 'utf8');

  assert.equal(fs.existsSync(mvSaveFile), true);
  assert.equal(fs.existsSync(path.join(rootSaveDir, 'file1.rpgsave')), false, 'MV save should remain in www/save');

  fs.rmSync(rootDir, { recursive: true, force: true });
});
