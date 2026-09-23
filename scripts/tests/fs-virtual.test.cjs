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
