const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  setupNwShim,
  createNwShim,
  createGreenworksShim,
  hookRequire,
  blockWindowResize,
  injectNwVersions
} = require('../../template/modules/nw-shim.js');

test('createNwShim returns correct App, Window, Shell properties', () => {
  const nw = createNwShim('/mock/game/dir', { width: 1280, height: 720 });
  assert.equal(nw.App.fullPath, '/mock/game/dir');
  assert.equal(nw.App.dataPath, '/mock/game/dir');

  const win = nw.Window.get();
  assert.equal(win.width, 1280);
  assert.equal(win.height, 720);
  assert.equal(win.isFullScreen, true);
  assert.equal(typeof win.resizeTo, 'function');
  assert.equal(typeof nw.Shell.openExternal, 'function');
});

test('createGreenworksShim emulates offline Steam API and persists achievements', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-steam-test-'));
  try {
    const greenworks = createGreenworksShim(tmpDir);
    assert.equal(greenworks.init(), true);
    assert.equal(greenworks.initAPI(), true);
    assert.equal(greenworks.isSteamRunning(), true);
    assert.equal(greenworks.getAppId(), 0);
    assert.equal(greenworks.getSteamId().screenName, 'Offline Player');
    assert.equal(greenworks.getSteamId().isValid(), true);

    let unlockedCb = false;
    greenworks.activateAchievement('FIRST_BLOOD', () => { unlockedCb = true; });
    assert.equal(unlockedCb, true);
    assert.equal(greenworks.getAchievement('FIRST_BLOOD'), true);
    assert.deepEqual(greenworks.getAchievementNames(), ['FIRST_BLOOD']);

    // Reload from persisted save/steam-profile.json
    const reloaded = createGreenworksShim(tmpDir);
    assert.equal(reloaded.getAchievement('FIRST_BLOOD'), true);
    assert.equal(reloaded.getSteamId().steamId, greenworks.getSteamId().steamId);

    reloaded.clearAchievement('FIRST_BLOOD');
    assert.equal(reloaded.getAchievement('FIRST_BLOOD'), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('hookRequire intercepts nw.gui and greenworks', () => {
  const mockNw = { isMockNw: true };
  const mockGreenworks = { isMockGreenworks: true };

  hookRequire(mockNw, mockGreenworks);

  const reqNw = require('nw.gui');
  assert.equal(reqNw.isMockNw, true);

  const reqGw = require('greenworks');
  assert.equal(reqGw.isMockGreenworks, true);
});

test('blockWindowResize replaces window.resizeTo with noop', () => {
  global.window = {
    resizeTo: () => 'original'
  };

  blockWindowResize();
  assert.notEqual(window.resizeTo(), 'original');
  assert.equal(window.resizeTo(), undefined);
});

test('injectNwVersions sets node-webkit version flags', () => {
  injectNwVersions();
  assert.equal(process.versions['node-webkit'], '0.13.0');
  assert.equal(process.versions['nw'], '0.13.0');
  assert.equal(process.versions['nw-flavor'], 'normal');
});

test('setupNwShim configures global window.nw and window.greenworks', () => {
  global.window = {};
  setupNwShim({ gameDir: '/test/dir', userOpt: { width: 1920, height: 1080 } });

  assert.ok(window.nw);
  assert.ok(window.nwGui);
  assert.ok(window.greenworks);
  assert.equal(window.nw.App.fullPath, '/test/dir');
});
