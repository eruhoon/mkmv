/**
 * mkmv Engine Hooks: Plugin Compatibility & Redraw Deduplication
 */

function applyYepEnemyNameRefresh() {
  if (typeof window === 'undefined' || !window.Window_EnemyVisualSelect || !window.Window_EnemyVisualSelect.prototype) {
    return false;
  }
  const proto = window.Window_EnemyVisualSelect.prototype;
  if (typeof proto.updateBattlerName !== 'function') return false;
  if (proto._mkmvYepNameHooked) return true;

  const src = proto.updateBattlerName.toString();
  const hasBugPattern = /if\s*\([^;{]*_battlerName\s*!==\s*[^;{]*\)\s*this\._battlerName\s*=/.test(src);
  if (!hasBugPattern) return false;

  proto._mkmvYepNameHooked = true;
  proto.updateBattlerName = function() {
    if (!this._battler) return;
    const name = this._battler.name();
    if (this._battlerName !== name) {
      this._battlerName = name;
      this._requestRefresh = true;
    }
  };
  return true;
}

function applyYepEnemySelectRefresh() {
  if (typeof window === 'undefined' || !window.Window_EnemyVisualSelect || !window.Window_EnemyVisualSelect.prototype) {
    return false;
  }
  const proto = window.Window_EnemyVisualSelect.prototype;
  if (typeof proto.refresh !== 'function') return false;
  if (proto._mkmvYepSelectHooked) return true;

  proto._mkmvYepSelectHooked = true;
  const origRefresh = proto.refresh;
  proto.refresh = function() {
    const battler = this._battler;
    if (battler && this._showEnemyName && !battler.isHidden()) {
      this._mkmvBlankContents = null;
      return origRefresh.apply(this, arguments);
    }
    if (this.contents && this._mkmvBlankContents !== this.contents) {
      this.contents.clear();
      this._mkmvBlankContents = this.contents;
    }
    if (battler && !this._showEnemyName) {
      this._requestRefresh = false;
    }
  };
  return true;
}

function applyRefreshIfSameDrawing() {
  if (typeof window === 'undefined') return false;

  const OPS = [
    'clear', 'clearRect', 'fillRect', 'fillAll', 'gradientFillRect',
    'drawCircle', 'drawText', 'blt', 'bltImage'
  ];
  const PROPS = [
    'fontFace', 'fontSize', 'fontItalic', 'textColor',
    'outlineColor', 'outlineWidth', 'paintOpacity', 'smooth'
  ];

  let uid = 0;
  function serializeArg(a) {
    if (a && typeof a === 'object') {
      if (!a._mkmvDrawId) a._mkmvDrawId = ++uid;
      const ready = typeof a.isReady === 'function' ? (a.isReady() ? 1 : 0) : 1;
      return `#${a._mkmvDrawId}:${a.width}x${a.height}:${ready}`;
    }
    return `${typeof a}:${String(a)}`;
  }

  function watchBitmap(bmp) {
    if (bmp._mkmvDraws) return;
    const origSetDirty = bmp._setDirty;
    bmp._mkmvDraws = 1;
    bmp._setDirty = function() {
      bmp._mkmvDraws++;
      if (bmp._mkmvRecording) bmp._mkmvOther = true;
      return origSetDirty.apply(this, arguments);
    };
  }

  function wrapRefresh(proto) {
    if (!proto || typeof proto.refresh !== 'function') return false;
    if (proto._mkmvSameDrawHooked) return true;
    proto._mkmvSameDrawHooked = true;

    const origRefresh = proto.refresh;
    proto.refresh = function() {
      const bmp = this.contents;
      if (!bmp || this._mkmvDrawOff || typeof bmp._setDirty !== 'function') {
        return origRefresh.apply(this, arguments);
      }
      watchBitmap(bmp);

      const calls = [];
      const keys = [];
      const real = Object.create(null);
      const own = Object.create(null);

      for (let i = 0; i < OPS.length; i++) {
        const name = OPS[i];
        if (typeof bmp[name] !== 'function') continue;
        real[name] = bmp[name];
        own[name] = Object.prototype.hasOwnProperty.call(bmp, name);
        bmp[name] = function() {
          let k = name;
          for (let a = 0; a < arguments.length; a++) k += '|' + serializeArg(arguments[a]);
          for (let p = 0; p < PROPS.length; p++) k += '|' + bmp[PROPS[p]];
          keys.push(k);
          calls.push([name, Array.prototype.slice.call(arguments)]);
        };
      }

      bmp._mkmvRecording = true;
      bmp._mkmvOther = false;
      let res;
      try {
        res = origRefresh.apply(this, arguments);
      } finally {
        bmp._mkmvRecording = false;
        const realKeys = Object.keys(real);
        for (let i = 0; i < realKeys.length; i++) {
          const name = realKeys[i];
          if (own[name]) bmp[name] = real[name];
          else delete bmp[name];
        }
      }

      if (bmp._mkmvOther || this.contents !== bmp) {
        this._mkmvDrawOff = true;
        return origRefresh.apply(this, arguments);
      }

      const key = keys.join('\n');
      if (
        key === this._mkmvDrawKey &&
        bmp === this._mkmvDrawBitmap &&
        bmp._mkmvDraws === this._mkmvDrawCount
      ) {
        return res;
      }

      for (let c = 0; c < calls.length; c++) {
        real[calls[c][0]].apply(bmp, calls[c][1]);
      }
      this._mkmvDrawKey = key;
      this._mkmvDrawBitmap = bmp;
      this._mkmvDrawCount = bmp._mkmvDraws;
      return res;
    };
    return true;
  }

  let hookedAny = false;
  if (window.Window_BattleEnemy && window.Window_BattleEnemy.prototype) {
    if (wrapRefresh(window.Window_BattleEnemy.prototype)) hookedAny = true;
  }
  if (window.Window_BattleStatus && window.Window_BattleStatus.prototype) {
    if (wrapRefresh(window.Window_BattleStatus.prototype)) hookedAny = true;
  }
  return hookedAny;
}

module.exports = {
  applyYepEnemyNameRefresh,
  applyYepEnemySelectRefresh,
  applyRefreshIfSameDrawing
};
