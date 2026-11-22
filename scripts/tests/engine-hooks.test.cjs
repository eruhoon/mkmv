const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createOptimizationRegistry,
  applyWindowLayerSkipEmpty,
  applyRequestImagesOnce,
  applySkipBranchTable,
  applyYepEnemyNameRefresh,
  applyYepEnemySelectRefresh,
  applyRefreshIfSameDrawing,
  applyLoadingNotice,
  applyToneFilterWhenNeeded,
  applyColorFilterIdentityOff,
  applyMenuBlurOnce,
  applyBattleRelease,
  applySceneRelease,
  applyBattleImagesRelease,
  applyRefreshIfChanged,
  applySpriteUpdateLoop,
  applyEventsCached,
  applySortIfNeeded
} = require('../../template/modules/engine-hooks.js');

test('createOptimizationRegistry respects disableOptimizations list and handles errors', () => {
  const reg = createOptimizationRegistry(['opt-disabled']);
  let ranEnabled = false;
  let ranDisabled = false;

  assert.equal(reg.register('opt-enabled', 'Enabled opt', () => { ranEnabled = true; return true; }), true);
  assert.equal(reg.register('opt-disabled', 'Disabled opt', () => { ranDisabled = true; return true; }), false);
  assert.equal(reg.register('opt-fail', 'Failing opt', () => { throw new Error('boom'); }), false);

  assert.equal(ranEnabled, true);
  assert.equal(ranDisabled, false);
  assert.equal(reg.isApplied('opt-enabled'), true);
  assert.equal(reg.isEnabled('opt-disabled'), false);
  assert.equal(reg.isEnabled('opt-fail'), false);
});

test('applyWindowLayerSkipEmpty skips filter pass when no window is open', () => {
  let origCalls = 0;
  let nonWinCalls = 0;

  function WindowLayer() {
    this.visible = true;
    this.renderable = true;
    this.children = [];
  }
  WindowLayer.prototype.renderWebGL = function() {
    origCalls++;
  };

  global.window = { WindowLayer };
  assert.equal(applyWindowLayerSkipEmpty(), true);

  const layer = new WindowLayer();
  layer.children = [
    { _isWindow: true, visible: true, openness: 0 },
    { _isWindow: false, renderWebGL: () => { nonWinCalls++; } }
  ];

  // No open windows -> skip original filter pass, render non-window child
  layer.renderWebGL({});
  assert.equal(origCalls, 0);
  assert.equal(nonWinCalls, 1);

  // Open window present -> invoke original renderWebGL
  layer.children[0].openness = 255;
  layer.renderWebGL({});
  assert.equal(origCalls, 1);
});

test('applyRequestImagesOnce deduplicates repeated calls for the same command list', () => {
  let calls = 0;
  function Game_Interpreter() {}
  Game_Interpreter.requestImages = function() { calls++; };

  global.window = { Game_Interpreter };
  assert.equal(applyRequestImagesOnce(), true);

  const listA = [{ code: 101 }];
  const listB = [{ code: 101 }];

  Game_Interpreter.requestImages(listA);
  Game_Interpreter.requestImages(listA);
  Game_Interpreter.requestImages(listB);

  assert.equal(calls, 2);
});

test('applySkipBranchTable jumps to end of indented block in O(1)', () => {
  function Game_Interpreter() {
    this._list = [
      { code: 111, indent: 0 }, // 0: if
      { code: 101, indent: 1 }, // 1: inside if
      { code: 111, indent: 1 }, // 2: nested if
      { code: 101, indent: 2 }, // 3: inside nested if
      { code: 412, indent: 1 }, // 4: end nested if
      { code: 411, indent: 0 }, // 5: else
      { code: 101, indent: 1 }, // 6: inside else
      { code: 412, indent: 0 }  // 7: end if
    ];
    this._index = 0;
    this._indent = 0;
  }
  Game_Interpreter.prototype.skipBranch = function() {
    throw new Error('Original linear skipBranch should not be called when table applies');
  };

  global.window = { Game_Interpreter };
  assert.equal(applySkipBranchTable(), true);

  const interp = new Game_Interpreter();
  interp.skipBranch();
  // Should jump to index 4 (just before indent 0 at index 5)
  assert.equal(interp._index, 4);

  interp._index = 2;
  interp._indent = 1;
  interp.skipBranch();
  // Nested if at index 2 (indent 1) should jump to index 3 (before indent 1 at index 4)
  assert.equal(interp._index, 3);
});

test('applyYepEnemyNameRefresh fixes missing-brace redraw bug', () => {
  function Window_EnemyVisualSelect() {
    this._battler = { name: () => 'Slime' };
    this._battlerName = 'Slime';
    this._requestRefresh = false;
  }
  // Exact YEP_BattleEngineCore missing-brace bug pattern
  Window_EnemyVisualSelect.prototype.updateBattlerName = function() {
    if (!this._battler) return;
    if (this._battlerName !== this._battler.name())
    this._battlerName = this._battler.name();
    this._requestRefresh = true;
  };

  global.window = { Window_EnemyVisualSelect };
  assert.equal(applyYepEnemyNameRefresh(), true);

  const win = new Window_EnemyVisualSelect();
  win.updateBattlerName();
  assert.equal(win._requestRefresh, false);

  win._battler = { name: () => 'Goblin' };
  win.updateBattlerName();
  assert.equal(win._battlerName, 'Goblin');
  assert.equal(win._requestRefresh, true);
});

test('applyYepEnemySelectRefresh avoids repeated clear when hidden', () => {
  let clearCalls = 0;
  let origCalls = 0;
  function Window_EnemyVisualSelect() {
    this._battler = { isHidden: () => true };
    this._showEnemyName = true;
    this.contents = { clear: () => { clearCalls++; } };
  }
  Window_EnemyVisualSelect.prototype.refresh = function() {
    origCalls++;
  };

  global.window = { Window_EnemyVisualSelect };
  assert.equal(applyYepEnemySelectRefresh(), true);

  const win = new Window_EnemyVisualSelect();
  win.refresh();
  win.refresh();
  assert.equal(clearCalls, 1);
  assert.equal(origCalls, 0);
});

test('applyRefreshIfSameDrawing skips identical redraws and falls back on external writes', () => {
  let drawCalls = 0;
  let dirtyCalls = 0;

  function MockBitmap() {
    this.fontFace = 'GameFont';
    this.fontSize = 28;
    this.fontItalic = false;
    this.textColor = '#ffffff';
    this.outlineColor = 'rgba(0,0,0,0.5)';
    this.outlineWidth = 4;
    this.paintOpacity = 255;
    this.smooth = true;
  }
  MockBitmap.prototype.clear = function() { drawCalls++; this._setDirty(); };
  MockBitmap.prototype.drawText = function() { drawCalls++; this._setDirty(); };
  MockBitmap.prototype._setDirty = function() { dirtyCalls++; };

  function Window_BattleStatus() {
    this.contents = new MockBitmap();
    this.hp = 100;
  }
  Window_BattleStatus.prototype.refresh = function() {
    this.contents.clear();
    this.contents.drawText(`HP: ${this.hp}`, 0, 0, 100, 32);
  };

  global.window = { Window_BattleStatus };
  assert.equal(applyRefreshIfSameDrawing(), true);

  const win = new Window_BattleStatus();
  // First refresh: draws normally
  win.refresh();
  assert.equal(drawCalls, 2);
  assert.equal(dirtyCalls, 2);

  // Second refresh with same state: skipped!
  win.refresh();
  assert.equal(drawCalls, 2);
  assert.equal(dirtyCalls, 2);

  // State changed: redraws!
  win.hp = 80;
  win.refresh();
  assert.equal(drawCalls, 4);
  assert.equal(dirtyCalls, 4);
});

test('applyLoadingNotice creates DOM badge and hides it on Scene_Map start', () => {
  const created = [];
  const createEl = () => {
    const styleMap = {};
    return {
      id: '',
      textContent: '',
      style: {
        setProperty(k, v) { styleMap[k] = v; },
        getPropertyValue(k) { return styleMap[k]; }
      }
    };
  };

  global.document = {
    createElement: () => {
      const el = createEl();
      created.push(el);
      return el;
    },
    body: {
      appendChild: () => {}
    }
  };

  function Scene_Map() {}
  Scene_Map.prototype.onMapLoaded = function() {};
  Scene_Map.prototype.start = function() {};
  function Scene_Battle() {}
  Scene_Battle.prototype.createDisplayObjects = function() {};
  Scene_Battle.prototype.start = function() {};

  global.window = {
    DataManager: {
      loadGame: () => false,
      setupNewGame: () => {}
    },
    Scene_Map,
    Scene_Battle,
    SceneManager: {}
  };

  assert.equal(applyLoadingNotice(), true);
  assert.equal(window.DataManager.loadGame(), false);
  assert.equal(created.length, 1);
  assert.equal(created[0].id, 'mkmv-loading-notice');
  assert.equal(created[0].style.getPropertyValue('display'), 'none');

  const map = new Scene_Map();
  map.start();
  assert.equal(created[0].style.getPropertyValue('display'), 'none');
});

test('applyToneFilterWhenNeeded removes neutral ToneFilter and restores on non-zero tone', () => {
  const tf = { isTone: true };
  const otherFilter = { isOther: true };
  function Spriteset_Base() {
    this._toneFilter = tf;
    this._tone = [0, 0, 0, 0];
    this._baseSprite = {
      _filters: [tf, otherFilter],
      set filters(val) { this._filters = val; },
      get filters() { return this._filters; }
    };
  }
  Spriteset_Base.prototype.updateToneChanger = function() {};

  global.window = {
    Spriteset_Base,
    Graphics: { isWebGL: () => true }
  };

  assert.equal(applyToneFilterWhenNeeded(), true);
  const ss = new Spriteset_Base();
  ss.updateToneChanger();
  assert.deepEqual(ss._baseSprite._filters, [otherFilter]);

  ss._tone = [10, 0, 0, 0];
  ss.updateToneChanger();
  assert.deepEqual(ss._baseSprite._filters, [tf, otherFilter]);
});

test('applyColorFilterIdentityOff disables neutral ColorFilter and enables on change', () => {
  function ColorFilter() {
    this.initialize();
  }
  ColorFilter.prototype.initialize = function() {
    this.uniforms = {
      hue: 0,
      colorTone: [0, 0, 0, 0],
      blendColor: [0, 0, 0, 0],
      brightness: 255
    };
  };

  global.window = { ColorFilter };
  assert.equal(applyColorFilterIdentityOff(), true);

  const filter = new ColorFilter();
  assert.equal(filter.enabled, false);

  filter.uniforms.brightness = 128;
  assert.equal(filter.enabled, true);

  filter.uniforms.brightness = 255;
  assert.equal(filter.enabled, false);
});

test('applyMenuBlurOnce caches blurred bitmap across Scene_MenuBase instances', () => {
  let renderCalls = 0;
  let destroyCalls = 0;

  function MockBitmap(w, h) {
    this.width = w;
    this.height = h;
    this.baseTexture = { update: () => {} };
    this.context = { drawImage: () => {} };
    this.isReady = () => true;
  }

  const bgSrc = new MockBitmap(816, 624);
  const blurFilter = { isBlur: true };

  function Scene_MenuBase() {
    this.children = [];
  }
  Scene_MenuBase.prototype.addChild = function(c) { this.children.push(c); };
  Scene_MenuBase.prototype.setBackgroundOpacity = function() {};
  Scene_MenuBase.prototype.createBackground = function() {
    this._backgroundFilter = blurFilter;
    this._backgroundSprite = new global.window.PIXI.Sprite();
    this._backgroundSprite.bitmap = bgSrc;
    this._backgroundSprite.filters = [this._backgroundFilter];
    this.addChild(this._backgroundSprite);
  };

  global.window = {
    Scene_MenuBase,
    Bitmap: MockBitmap,
    Graphics: {
      app: {
        renderer: {
          render: () => { renderCalls++; },
          extract: { canvas: () => ({ width: 816, height: 624 }) }
        }
      }
    },
    PIXI: {
      Sprite: function() {},
      Texture: function(bt) { this.baseTexture = bt; },
      RenderTexture: {
        create: () => ({ destroy: () => { destroyCalls++; } })
      }
    }
  };

  assert.equal(applyMenuBlurOnce(), true);

  const m1 = new Scene_MenuBase();
  m1.createBackground();
  assert.equal(renderCalls, 1);
  assert.equal(destroyCalls, 1);
  assert.equal(m1._backgroundSprite.filters, null);
  assert.notEqual(m1._backgroundSprite.bitmap, bgSrc);

  // Second menu reuses cached blurred bitmap without calling renderer.render again
  const m2 = new Scene_MenuBase();
  m2.createBackground();
  assert.equal(renderCalls, 1);
  assert.equal(m2._backgroundSprite.bitmap, m1._backgroundSprite.bitmap);
});

test('applyBattleRelease and applySceneRelease clear retained DisplayObject references', () => {
  function DisplayObject() {
    this.parent = null;
  }
  function Scene_Base() { DisplayObject.call(this); }
  Object.setPrototypeOf(Scene_Base.prototype, DisplayObject.prototype);
  Scene_Base.prototype.terminate = function() {};

  function Scene_Battle() { Scene_Base.call(this); }
  Object.setPrototypeOf(Scene_Battle.prototype, Scene_Base.prototype);
  Scene_Battle.prototype.terminate = function() {
    Scene_Base.prototype.terminate.call(this);
  };

  const childSprite = new DisplayObject();
  const battleScene = new Scene_Battle();
  childSprite.parent = battleScene;

  const batchPlugin = { sprites: [childSprite], currentIndex: 0 };
  global.window = {
    PIXI: { DisplayObject },
    Scene_Base,
    Scene_Battle,
    BattleManager: {
      _spriteset: new DisplayObject(),
      _registeredSprites: { a: new DisplayObject() },
      _phase: 'battleEnd'
    },
    Graphics: {
      _renderer: {
        plugins: { sprite: batchPlugin }
      }
    },
    leakedChildSprite: childSprite
  };

  assert.equal(applySceneRelease(), true);
  assert.equal(applyBattleRelease(), true);

  battleScene.terminate();
  assert.equal(global.window.BattleManager._spriteset, null);
  assert.deepEqual(global.window.BattleManager._registeredSprites, {});
  assert.equal(global.window.BattleManager._phase, 'battleEnd');
  assert.equal(batchPlugin.sprites.length, 0);
  assert.equal(global.window.leakedChildSprite, null);
});

test('applyBattleImagesRelease destroys only battle-added images on battle end', () => {
  function Scene_Map() {}
  function Scene_Battle() {}

  let destroyed = [];
  const mapBitmap = { destroy: () => destroyed.push('map') };
  const enemyBitmap = { destroy: () => destroyed.push('enemy') };

  const cache = { 'img/tilesets/a.png': mapBitmap };

  global.window = {
    Scene_Map,
    Scene_Battle,
    ImageManager: { _cache: cache },
    SceneManager: {
      _scene: new Scene_Map(),
      _nextScene: new Scene_Battle(),
      onSceneTerminate: function() {}
    }
  };

  assert.equal(applyBattleImagesRelease(), true);

  // Enter battle: snapshot map cache
  window.SceneManager.onSceneTerminate();

  // Battle loads enemy image
  cache['img/enemies/slime.png'] = enemyBitmap;

  // Exit battle back to map
  window.SceneManager._scene = new Scene_Battle();
  window.SceneManager._nextScene = new Scene_Map();
  window.SceneManager.onSceneTerminate();

  assert.deepEqual(destroyed, ['enemy']);
  assert.ok(cache['img/tilesets/a.png']);
  assert.equal(cache['img/enemies/slime.png'], undefined);
});

test('applyRefreshIfChanged skips onChange when value is unchanged', () => {
  let onChangeCalls = 0;
  function Game_Switches() { this._data = {}; }
  Game_Switches.prototype.onChange = function() { onChangeCalls++; };
  Game_Switches.prototype.setValue = function(id, val) {
    this._data[id] = Boolean(val);
    this.onChange();
  };

  global.window = { Game_Switches };
  assert.equal(applyRefreshIfChanged(), true);

  const sw = new Game_Switches();
  sw.setValue(1, true);
  assert.equal(onChangeCalls, 1);

  sw.setValue(1, true);
  assert.equal(onChangeCalls, 1);

  sw.setValue(1, false);
  assert.equal(onChangeCalls, 2);
});

test('applySpriteUpdateLoop, applyEventsCached, and applySortIfNeeded optimize hot paths', () => {
  // Sprite.update
  let childUpdates = 0;
  function Sprite() {
    this.children = [{ update: () => childUpdates++ }, { update: () => childUpdates++ }];
  }
  Sprite.prototype.update = function() {
    this.children.forEach(function(child) {
      if (child.update) child.update();
    });
  };

  // Game_Map.events
  let filterCalls = 0;
  function Game_Map() {
    this._events = [null, { id: 1 }, { id: 2 }];
  }
  Game_Map.prototype.events = function() {
    filterCalls++;
    return this._events.filter(Boolean);
  };

  // Tilemap._sortChildren
  let sortCalls = 0;
  function Tilemap() {
    this.children = [{ y: 1 }, { y: 2 }, { y: 3 }];
  }
  Tilemap.prototype._compareChildOrder = (a, b) => a.y - b.y;
  Tilemap.prototype._sortChildren = function() {
    sortCalls++;
    this.children.sort(this._compareChildOrder);
  };

  global.window = { Sprite, Game_Map, Tilemap };
  assert.equal(applySpriteUpdateLoop(), true);
  assert.equal(applyEventsCached(), true);
  assert.equal(applySortIfNeeded(), true);

  const sp = new Sprite();
  sp.update();
  assert.equal(childUpdates, 2);

  const gm = new Game_Map();
  const e1 = gm.events();
  const e2 = gm.events();
  assert.equal(filterCalls, 1);
  assert.equal(e1, e2);

  const tm = new Tilemap();
  tm._sortChildren();
  assert.equal(sortCalls, 0);
  tm.children = [{ y: 5 }, { y: 1 }];
  tm._sortChildren();
  assert.equal(sortCalls, 1);
  assert.deepEqual(tm.children.map(c => c.y), [1, 5]);
});
