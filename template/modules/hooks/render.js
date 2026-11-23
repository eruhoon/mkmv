/**
 * mkmv Engine Hooks: WebGL/Render Filter & Sort Optimizations
 */

function applyWindowLayerSkipEmpty() {
  if (typeof window === 'undefined' || !window.WindowLayer || !window.WindowLayer.prototype) return false;
  const proto = window.WindowLayer.prototype;
  if (typeof proto.renderWebGL !== 'function') return false;
  if (proto._mkmvWindowLayerSkipHooked) return true;
  proto._mkmvWindowLayerSkipHooked = true;

  const origRenderWebGL = proto.renderWebGL;
  proto.renderWebGL = function(renderer) {
    if (!this.visible || !this.renderable) return;
    const ch = this.children || [];
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      if (c && c._isWindow && c.visible && c.openness > 0) {
        return origRenderWebGL.apply(this, arguments);
      }
    }
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      if (c && !c._isWindow && typeof c.renderWebGL === 'function') {
        c.renderWebGL(renderer);
      }
    }
  };
  return true;
}

function applyToneFilterWhenNeeded() {
  if (typeof window === 'undefined' || !window.Spriteset_Base || !window.Spriteset_Base.prototype) {
    return false;
  }
  const proto = window.Spriteset_Base.prototype;
  if (typeof proto.updateToneChanger !== 'function') return false;
  if (proto._mkmvToneFilterHooked) return true;
  proto._mkmvToneFilterHooked = true;

  const origUpdateToneChanger = proto.updateToneChanger;
  proto.updateToneChanger = function() {
    const r = origUpdateToneChanger.apply(this, arguments);
    const b = this._baseSprite;
    const tf = this._toneFilter;
    const t = this._tone;
    if (
      !b || !tf || !t ||
      !window.Graphics ||
      typeof window.Graphics.isWebGL !== 'function' ||
      !window.Graphics.isWebGL()
    ) {
      return r;
    }
    const list = b._filters || null;
    const has = Boolean(list && list.indexOf(tf) >= 0);
    const neutral = !(t[0] || t[1] || t[2] || t[3]);
    if (neutral && has) {
      const rest = [];
      for (let i = 0; i < list.length; i++) {
        if (list[i] !== tf) rest.push(list[i]);
      }
      b.filters = rest.length ? rest : null;
    } else if (!neutral && !has) {
      b.filters = [tf].concat(list || []);
    }
    return r;
  };
  return true;
}

function applyColorFilterIdentityOff() {
  if (typeof window === 'undefined' || !window.ColorFilter || !window.ColorFilter.prototype) {
    return false;
  }
  const proto = window.ColorFilter.prototype;
  if (typeof proto.initialize !== 'function') return false;
  if (proto._mkmvColorFilterHooked) return true;
  proto._mkmvColorFilterHooked = true;

  function isNeutral(u) {
    if (!u) return false;
    const t = u.colorTone;
    const b = u.blendColor;
    return (
      u.hue === 0 &&
      u.brightness === 255 &&
      Boolean(t) && t[0] === 0 && t[1] === 0 && t[2] === 0 && t[3] === 0 &&
      Boolean(b) && b[3] === 0
    );
  }

  if (!Object.prototype.hasOwnProperty.call(proto, 'enabled')) {
    Object.defineProperty(proto, 'enabled', {
      configurable: true,
      get: function() {
        if (this.__mkmvEnabled === false) return false;
        return !(this.__mkmvNeutralOff && isNeutral(this.uniforms));
      },
      set: function(v) {
        this.__mkmvEnabled = Boolean(v);
      }
    });
  }

  const origInit = proto.initialize;
  proto.initialize = function() {
    const r = origInit.apply(this, arguments);
    if (this.uniforms && this.uniforms.colorTone && this.uniforms.blendColor) {
      this.__mkmvNeutralOff = true;
    }
    return r;
  };
  return true;
}

function applyMenuBlurOnce() {
  if (typeof window === 'undefined' || !window.Scene_MenuBase || !window.Scene_MenuBase.prototype) {
    return false;
  }
  const proto = window.Scene_MenuBase.prototype;
  if (typeof proto.createBackground !== 'function') return false;
  if (proto._mkmvMenuBlurHooked) return true;
  proto._mkmvMenuBlurHooked = true;

  let lastSrc = null;
  let lastOut = null;

  function createBlurredBitmap(src, filter) {
    if (lastSrc === src && lastOut && lastOut.baseTexture) return lastOut;
    const renderer = window.Graphics && window.Graphics.app && window.Graphics.app.renderer;
    if (!renderer || !renderer.extract || !window.PIXI || !window.PIXI.RenderTexture || typeof window.Bitmap !== 'function') {
      return null;
    }
    const w = src.width;
    const h = src.height;
    const tmp = new window.PIXI.Sprite(new window.PIXI.Texture(src.baseTexture));
    tmp.filters = [filter];
    const rt = window.PIXI.RenderTexture.create(w, h);
    renderer.render(tmp, rt);
    const canvas = renderer.extract.canvas(rt);
    const out = new window.Bitmap(w, h);
    if (out.context && typeof out.context.drawImage === 'function') {
      out.context.drawImage(canvas, 0, 0);
    }
    canvas.width = 0;
    canvas.height = 0;
    if (out.baseTexture && typeof out.baseTexture.update === 'function') {
      out.baseTexture.update();
    }
    rt.destroy(true);
    tmp.filters = null;
    lastSrc = src;
    lastOut = out;
    return out;
  }

  const origCreateBg = proto.createBackground;
  proto.createBackground = function() {
    const r = origCreateBg.apply(this, arguments);
    const sprite = this._backgroundSprite;
    const filter = this._backgroundFilter;
    const src = sprite && sprite.bitmap;
    const list = sprite && sprite.filters;
    if (
      !src || !filter || !src.baseTexture ||
      (typeof src.isReady === 'function' && !src.isReady()) ||
      !(src.width > 0 && src.height > 0) ||
      !list || list.length !== 1 || list[0] !== filter
    ) {
      return r;
    }
    try {
      const out = createBlurredBitmap(src, filter);
      if (out) {
        sprite.bitmap = out;
        sprite.filters = null;
      }
    } catch (e) {
      sprite.bitmap = src;
      sprite.filters = list;
    }
    return r;
  };
  return true;
}

function applySortIfNeeded() {
  if (typeof window === 'undefined' || !window.Tilemap || !window.Tilemap.prototype) return false;
  const proto = window.Tilemap.prototype;
  if (typeof proto._sortChildren !== 'function') return false;
  if (proto._mkmvSortIfNeededHooked) return true;
  proto._mkmvSortIfNeededHooked = true;

  const origSortChildren = proto._sortChildren;
  proto._sortChildren = function() {
    const list = this.children;
    const compare = this._compareChildOrder;
    if (!list || typeof compare !== 'function') {
      return origSortChildren.apply(this, arguments);
    }
    for (let i = 1; i < list.length; i++) {
      if (!(compare.call(this, list[i - 1], list[i]) <= 0)) {
        return origSortChildren.apply(this, arguments);
      }
    }
  };
  return true;
}

function applySpriteTintSkipSame() {
  if (typeof window === 'undefined' || !window.Sprite || !window.Sprite.prototype) return false;
  const proto = window.Sprite.prototype;
  if (proto._mkmvTintSkipHooked) return true;

  let hookedAny = false;
  const same4 = (a, b) => (
    a && b && a.length >= 4 && b.length >= 4 &&
    a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
  );

  if (typeof proto.setBlendColor === 'function') {
    const origSetBlendColor = proto.setBlendColor;
    proto.setBlendColor = function(color) {
      if (same4(this._blendColor, color)) return;
      return origSetBlendColor.apply(this, arguments);
    };
    hookedAny = true;
  }

  if (typeof proto.setColorTone === 'function') {
    const origSetColorTone = proto.setColorTone;
    proto.setColorTone = function(tone) {
      if (same4(this._colorTone, tone)) return;
      return origSetColorTone.apply(this, arguments);
    };
    hookedAny = true;
  }

  if (hookedAny) proto._mkmvTintSkipHooked = true;
  return hookedAny;
}

function applyBlurFilterHalfRes() {
  if (typeof window === 'undefined' || !window.PIXI || !window.PIXI.filters) return false;
  const filters = window.PIXI.filters;
  const OrigBlurFilter = filters.BlurFilter;
  if (typeof OrigBlurFilter !== 'function') return false;
  if (OrigBlurFilter._mkmvHalfResHooked) return true;

  const WrappedBlurFilter = new Proxy(OrigBlurFilter, {
    construct(target, args, newTarget) {
      const inst = Reflect.construct(target, args, newTarget === WrappedBlurFilter ? target : newTarget);
      if (inst && (inst.resolution === undefined || inst.resolution === 1)) {
        inst.resolution = 0.5;
      }
      return inst;
    }
  });
  WrappedBlurFilter._mkmvHalfResHooked = true;
  filters.BlurFilter = WrappedBlurFilter;
  return true;
}

module.exports = {
  applyWindowLayerSkipEmpty,
  applyToneFilterWhenNeeded,
  applyColorFilterIdentityOff,
  applyMenuBlurOnce,
  applySortIfNeeded,
  applySpriteTintSkipSame,
  applyBlurFilterHalfRes
};
