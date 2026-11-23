/**
 * mkmv Engine Hooks: Interpreter, Map & Sprite Loop Optimizations
 */

function applyRequestImagesOnce() {
  if (typeof window === 'undefined' || !window.Game_Interpreter) return false;
  if (typeof window.Game_Interpreter.requestImages !== 'function') return false;
  if (window.Game_Interpreter._mkmvRequestImagesHooked) return true;
  window.Game_Interpreter._mkmvRequestImagesHooked = true;

  const seen = typeof WeakSet === 'function' ? new WeakSet() : null;
  const origRequestImages = window.Game_Interpreter.requestImages;
  window.Game_Interpreter.requestImages = function(list) {
    if (!list) return;
    if (seen) {
      if (seen.has(list)) return;
      seen.add(list);
    }
    return origRequestImages.apply(this, arguments);
  };
  return true;
}

function applySkipBranchTable() {
  if (typeof window === 'undefined' || !window.Game_Interpreter || !window.Game_Interpreter.prototype) return false;
  const proto = window.Game_Interpreter.prototype;
  if (typeof proto.skipBranch !== 'function') return false;
  if (proto._mkmvSkipBranchHooked) return true;
  proto._mkmvSkipBranchHooked = true;

  const tables = typeof WeakMap === 'function' ? new WeakMap() : null;
  const origSkipBranch = proto.skipBranch;

  function buildJumpTable(list) {
    const n = list.length;
    const ends = new Int32Array(n);
    const stack = [];
    for (let i = n - 1; i >= 0; i--) {
      const indent = list[i] ? list[i].indent : 0;
      while (stack.length && (list[stack[stack.length - 1]] ? list[stack[stack.length - 1]].indent : 0) > indent) {
        stack.pop();
      }
      ends[i] = stack.length ? stack[stack.length - 1] - 1 : n - 1;
      stack.push(i);
    }
    return ends;
  }

  proto.skipBranch = function() {
    const list = this._list;
    const i = this._index;
    if (!tables || !list || !list[i] || list[i].indent !== this._indent) {
      return origSkipBranch.apply(this, arguments);
    }
    let ends = tables.get(list);
    if (!ends || ends.length !== list.length) {
      ends = buildJumpTable(list);
      tables.set(list, ends);
    }
    this._index = ends[i];
  };
  return true;
}

function applyRefreshIfChanged() {
  if (typeof window === 'undefined') return false;
  const quiet = function() {};

  function wrapSetValue(ctor) {
    if (!ctor || !ctor.prototype || typeof ctor.prototype.setValue !== 'function') return false;
    if (ctor.prototype._mkmvRefreshIfChangedHooked) return true;
    ctor.prototype._mkmvRefreshIfChangedHooked = true;

    const origSetValue = ctor.prototype.setValue;
    ctor.prototype.setValue = function(key) {
      const data = this._data;
      if (!data) return origSetValue.apply(this, arguments);
      const had = Object.prototype.hasOwnProperty.call(data, key);
      const before = data[key];
      this.onChange = quiet;
      try {
        origSetValue.apply(this, arguments);
      } finally {
        delete this.onChange;
      }
      const has = Object.prototype.hasOwnProperty.call(data, key);
      if ((has !== had || data[key] !== before) && typeof this.onChange === 'function') {
        this.onChange();
      }
    };
    return true;
  }

  let hookedAny = false;
  if (wrapSetValue(window.Game_Switches)) hookedAny = true;
  if (wrapSetValue(window.Game_Variables)) hookedAny = true;
  if (wrapSetValue(window.Game_SelfSwitches)) hookedAny = true;
  return hookedAny;
}

function applySpriteUpdateLoop() {
  if (typeof window === 'undefined' || !window.Sprite || !window.Sprite.prototype) return false;
  const proto = window.Sprite.prototype;
  if (typeof proto.update !== 'function') return false;
  if (proto._mkmvSpriteLoopHooked) return true;

  const src = proto.update.toString();
  if (src.length > 220 || !/this\.children\.forEach/.test(src)) return false;

  proto._mkmvSpriteLoopHooked = true;
  proto.update = function() {
    const ch = this.children;
    const len = ch.length;
    for (let i = 0; i < len; i++) {
      if (!(i in ch)) continue;
      const c = ch[i];
      if (c && c.update) c.update();
    }
  };
  return true;
}

function applyEventsCached() {
  if (typeof window === 'undefined' || !window.Game_Map || !window.Game_Map.prototype) return false;
  const proto = window.Game_Map.prototype;
  if (typeof proto.events !== 'function') return false;
  if (proto._mkmvEventsCachedHooked) return true;
  proto._mkmvEventsCachedHooked = true;

  const origEvents = proto.events;
  proto.events = function() {
    const all = this._events;
    let list = this.__mkmvEvents;
    if (!Array.isArray(all)) return origEvents.call(this);
    if (list) {
      let j = 0;
      let ok = true;
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        if (!e) continue;
        if (list[j] !== e) {
          ok = false;
          break;
        }
        j++;
      }
      if (ok && j === list.length) return list;
    }
    list = origEvents.call(this);
    this.__mkmvEvents = list;
    return list;
  };
  return true;
}

module.exports = {
  applyRequestImagesOnce,
  applySkipBranchTable,
  applyRefreshIfChanged,
  applySpriteUpdateLoop,
  applyEventsCached
};
