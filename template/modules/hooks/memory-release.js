/**
 * mkmv Engine Hooks: Scene & Battle Memory Release
 */

function applyBattleRelease() {
  if (typeof window === 'undefined' || !window.Scene_Battle || !window.Scene_Battle.prototype || !window.BattleManager) {
    return false;
  }
  const proto = window.Scene_Battle.prototype;
  if (typeof proto.terminate !== 'function') return false;
  if (!window.PIXI || typeof window.PIXI.DisplayObject !== 'function') return false;
  if (proto._mkmvBattleReleaseHooked) return true;
  proto._mkmvBattleReleaseHooked = true;

  const DisplayObject = window.PIXI.DisplayObject;
  const isDisplay = v => v instanceof DisplayObject;
  const isDisplayMap = v => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || isDisplay(v)) return false;
    const keys = Object.keys(v);
    if (!keys.length) return false;
    for (let i = 0; i < keys.length; i++) {
      if (!isDisplay(v[keys[i]])) return false;
    }
    return true;
  };

  const origTerminate = proto.terminate;
  proto.terminate = function() {
    const r = origTerminate.apply(this, arguments);
    const bm = window.BattleManager;
    if (bm) {
      const keys = Object.keys(bm);
      for (let i = 0; i < keys.length; i++) {
        const v = bm[keys[i]];
        if (isDisplay(v)) bm[keys[i]] = null;
        else if (isDisplayMap(v)) bm[keys[i]] = {};
      }
    }
    return r;
  };
  return true;
}

function applySceneRelease() {
  if (typeof window === 'undefined' || !window.Scene_Base || !window.Scene_Base.prototype) {
    return false;
  }
  const proto = window.Scene_Base.prototype;
  if (typeof proto.terminate !== 'function') return false;
  if (!window.PIXI || typeof window.PIXI.DisplayObject !== 'function') return false;
  if (proto._mkmvSceneReleaseHooked) return true;
  proto._mkmvSceneReleaseHooked = true;

  const DisplayObject = window.PIXI.DisplayObject;
  const clearFilterStack = fd => {
    if (!fd || !Array.isArray(fd.stack)) return;
    for (let i = (fd.index | 0) + 1; i < fd.stack.length; i++) {
      const st = fd.stack[i];
      if (st) {
        st.target = null;
        st.filters = [];
        st.renderTarget = null;
      }
    }
  };

  const origTerminate = proto.terminate;
  proto.terminate = function() {
    const r = origTerminate.apply(this, arguments);
    const renderer = window.Graphics && window.Graphics._renderer;
    if (renderer) {
      const plugins = renderer.plugins || {};
      const pluginKeys = Object.keys(plugins);
      for (let i = 0; i < pluginKeys.length; i++) {
        const p = plugins[pluginKeys[i]];
        if (p && Array.isArray(p.sprites) && (p.currentIndex | 0) === 0) {
          p.sprites.length = 0;
        }
      }
      if (renderer.filterManager) clearFilterStack(renderer.filterManager.filterData);
      if (renderer._activeRenderTarget) clearFilterStack(renderer._activeRenderTarget.filterData);
      if (renderer.rootRenderTarget) clearFilterStack(renderer.rootRenderTarget.filterData);
    }

    const scene = this;
    const globalKeys = Object.keys(window);
    for (let j = 0; j < globalKeys.length; j++) {
      let o;
      try {
        o = window[globalKeys[j]];
      } catch (e) {
        continue;
      }
      if (!o || typeof o !== 'object' || !(o instanceof DisplayObject)) continue;
      while (o.parent) o = o.parent;
      if (o === scene) {
        try { window[globalKeys[j]] = null; } catch (e) {}
      }
    }
    return r;
  };
  return true;
}

function applyBattleImagesRelease() {
  if (typeof window === 'undefined' || !window.SceneManager || !window.Scene_Battle || !window.ImageManager) {
    return false;
  }
  if (typeof window.SceneManager.onSceneTerminate !== 'function') return false;
  if (!window.ImageManager._cache || typeof window.ImageManager._cache !== 'object') return false;
  if (window.SceneManager._mkmvBattleImagesHooked) return true;
  window.SceneManager._mkmvBattleImagesHooked = true;

  let before = null;
  let beforeKeys = null;
  const isBattle = scene => Boolean(scene && scene instanceof window.Scene_Battle);

  const origOnSceneTerminate = window.SceneManager.onSceneTerminate;
  window.SceneManager.onSceneTerminate = function() {
    const ending = this._scene;
    const next = this._nextScene;
    const r = origOnSceneTerminate.apply(this, arguments);
    const cache = window.ImageManager._cache;

    if (isBattle(next) && !isBattle(ending)) {
      before = cache;
      beforeKeys = Object.create(null);
      for (const url in cache) beforeKeys[url] = true;
    } else if (isBattle(ending) && !isBattle(next)) {
      if (before === cache && beforeKeys) {
        for (const u in cache) {
          if (beforeKeys[u]) continue;
          const bitmap = cache[u];
          delete cache[u];
          if (bitmap && typeof bitmap.destroy === 'function') {
            bitmap.destroy();
          }
        }
      }
      before = null;
      beforeKeys = null;
    }
    return r;
  };
  return true;
}

module.exports = {
  applyBattleRelease,
  applySceneRelease,
  applyBattleImagesRelease
};
