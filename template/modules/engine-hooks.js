/**
 * mkmv Engine Optimization Hooks & Stall Loading Indicator
 *
 * quixjs / pmjs의 프로파일링 및 호환성 설계를 참고하여,
 * RPG Maker MV/MZ의 순수 JS 병목 지점을 최적화하고
 * 씬 전환/로드 스톨 시 "Loading..." 배지를 표시합니다.
 *
 * 모든 최적화는 mkmv.json의 `disableOptimizations` 배열을 통해
 * 개별적으로 비활성화(원본 폴백)할 수 있습니다.
 */

const { createLogger } = require('./logger.js');
const logger = createLogger('mkmv-hooks');

/**
 * 최적화 레지스트리 생성
 * @param {string[]} disableList 비활성화할 최적화 ID 목록
 */
function createOptimizationRegistry(disableList = []) {
  const disabledSet = new Set(Array.isArray(disableList) ? disableList : []);
  const states = Object.create(null);

  return {
    register(id, description, applyFn) {
      if (!states[id]) {
        states[id] = {
          id,
          description,
          enabled: !disabledSet.has(id),
          applied: false,
          disabledByConfig: disabledSet.has(id)
        };
      }
      const state = states[id];
      if (!state.enabled || state.applied) return false;

      try {
        const applied = Boolean(applyFn());
        if (applied) {
          state.applied = true;
          logger.debug(`Optimization applied: ${id} (${description})`);
        }
        return applied;
      } catch (e) {
        state.enabled = false;
        state.error = e && e.message ? e.message : String(e);
        logger.warn(`Optimization failed and fell back (${id}):`, state.error);
        return false;
      }
    },
    isApplied(id) {
      return Boolean(states[id] && states[id].applied);
    },
    isEnabled(id) {
      return Boolean(states[id] && states[id].enabled);
    },
    dump() {
      return Object.keys(states).map(k => ({ ...states[k] }));
    }
  };
}

/**
 * 1. WindowLayer.prototype.renderWebGL:
 * 열린 창이 하나도 없을 때 풀스크린 필터 패스(pushFilter/popFilter)를 건너뜁니다.
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

/**
 * 2. Game_Interpreter.requestImages:
 * 동일한 이벤트 커맨드 리스트에 대해 반복적인 이미지 프리로드 순회를 1회로 제한합니다.
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

/**
 * 3. Game_Interpreter.prototype.skipBranch:
 * 조건문 분기 스킵 시 매번 선형 탐색하지 않고, 커맨드 리스트별 점프 테이블을 1회 구축해 O(1)로 점프합니다.
 */
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

/**
 * 4. YEP_BattleEngineCore: Window_EnemyVisualSelect.prototype.updateBattlerName
 * 중괄호 누락 버그로 매 프레임 _requestRefresh = true가 실행되어 GPU 재업로드를 유발하는 문제를 수정합니다.
 */
function applyYepEnemyNameRefresh() {
  if (typeof window === 'undefined' || !window.Window_EnemyVisualSelect || !window.Window_EnemyVisualSelect.prototype) {
    return false;
  }
  const proto = window.Window_EnemyVisualSelect.prototype;
  if (typeof proto.updateBattlerName !== 'function') return false;
  if (proto._mkmvYepNameHooked) return true;

  const src = proto.updateBattlerName.toString();
  // YEP_BattleEngineCore의 전형적인 중괄호 누락 패턴만 안전하게 교정
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

/**
 * 5. YEP_BattleEngineCore: Window_EnemyVisualSelect.prototype.refresh
 * 적 이름이 숨겨져 있거나 표시 꺼짐 상태일 때 매 프레임 contents.clear() 호출을 방지합니다.
 */
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

/**
 * 6. Window_BattleEnemy / Window_BattleStatus.prototype.refresh:
 * 그리기 호출과 스타일이 직전과 완전히 동일하면 캔버스 재그리기 및 GPU 업로드를 생략합니다.
 */
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

/**
 * 7. 스톨 감지 "Loading..." DOM 배지:
 * 세이브 로드, 맵 전환, 전투 진입 시 일정 시간 이상 지연되면 우측 하단에 "Loading..."을 표시합니다.
 */
function applyLoadingNotice() {
  if (typeof window === 'undefined' || !window.DataManager || !window.Scene_Map || !window.Scene_Battle) {
    return false;
  }
  if (window.DataManager._mkmvLoadingHooked) return true;
  window.DataManager._mkmvLoadingHooked = true;

  let badge = null;
  let showTimer = null;
  let maxTimer = null;

  function ensureBadge() {
    if (badge || typeof document === 'undefined') return badge;
    const el = document.createElement('div');
    el.id = 'mkmv-loading-notice';
    el.textContent = 'Loading...';
    el.style.setProperty('position', 'fixed', 'important');
    el.style.setProperty('bottom', '14px', 'important');
    el.style.setProperty('right', '16px', 'important');
    el.style.setProperty('z-index', '2147483647', 'important');
    el.style.setProperty('background-color', 'rgba(0, 0, 0, 0.78)', 'important');
    el.style.setProperty('color', '#ffffff', 'important');
    el.style.setProperty('font-family', 'sans-serif', 'important');
    el.style.setProperty('font-size', '14px', 'important');
    el.style.setProperty('font-weight', 'bold', 'important');
    el.style.setProperty('padding', '6px 12px', 'important');
    el.style.setProperty('border-radius', '4px', 'important');
    el.style.setProperty('border', '1px solid rgba(255, 255, 255, 0.25)', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    el.style.setProperty('user-select', 'none', 'important');
    el.style.setProperty('display', 'none', 'important');
    if (document.body) {
      document.body.appendChild(el);
    } else if (typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) document.body.appendChild(el);
      });
    }
    badge = el;
    return badge;
  }

  function showLoading(afterMs = 1000) {
    hideLoading();
    const el = ensureBadge();
    if (!el) return;

    const trigger = () => {
      el.style.setProperty('display', 'block', 'important');
      maxTimer = setTimeout(hideLoading, 30000);
      if (maxTimer && maxTimer.unref) maxTimer.unref();
    };

    if (afterMs <= 0) {
      trigger();
    } else {
      showTimer = setTimeout(trigger, afterMs);
      if (showTimer && showTimer.unref) showTimer.unref();
    }
  }

  function hideLoading() {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
    if (badge) {
      badge.style.setProperty('display', 'none', 'important');
    }
  }

  function isFromMenu() {
    const sm = window.SceneManager;
    const prev = sm ? sm._previousClass : null;
    return Boolean(
      prev &&
      typeof window.Scene_MenuBase === 'function' &&
      (prev === window.Scene_MenuBase || prev.prototype instanceof window.Scene_MenuBase)
    );
  }

  function isFromTitle() {
    const sm = window.SceneManager;
    const scene = sm ? sm._scene : null;
    return Boolean(scene && typeof window.Scene_Title === 'function' && scene instanceof window.Scene_Title);
  }

  if (typeof window.DataManager.loadGame === 'function') {
    const origLoadGame = window.DataManager.loadGame;
    window.DataManager.loadGame = function() {
      showLoading(250);
      const res = origLoadGame.apply(this, arguments);
      if (res === false) hideLoading();
      return res;
    };
  }

  if (typeof window.DataManager.setupNewGame === 'function') {
    const origSetupNewGame = window.DataManager.setupNewGame;
    window.DataManager.setupNewGame = function() {
      if (isFromTitle()) showLoading(250);
      return origSetupNewGame.apply(this, arguments);
    };
  }

  if (window.Scene_Map.prototype) {
    if (typeof window.Scene_Map.prototype.onMapLoaded === 'function') {
      const origOnMapLoaded = window.Scene_Map.prototype.onMapLoaded;
      window.Scene_Map.prototype.onMapLoaded = function() {
        if (!isFromMenu()) showLoading(1000);
        return origOnMapLoaded.apply(this, arguments);
      };
    }
    if (typeof window.Scene_Map.prototype.start === 'function') {
      const origMapStart = window.Scene_Map.prototype.start;
      window.Scene_Map.prototype.start = function() {
        const res = origMapStart.apply(this, arguments);
        hideLoading();
        return res;
      };
    }
  }

  if (window.Scene_Battle.prototype) {
    if (typeof window.Scene_Battle.prototype.createDisplayObjects === 'function') {
      const origCreateBattle = window.Scene_Battle.prototype.createDisplayObjects;
      window.Scene_Battle.prototype.createDisplayObjects = function() {
        showLoading(1000);
        return origCreateBattle.apply(this, arguments);
      };
    }
    if (typeof window.Scene_Battle.prototype.start === 'function') {
      const origBattleStart = window.Scene_Battle.prototype.start;
      window.Scene_Battle.prototype.start = function() {
        const res = origBattleStart.apply(this, arguments);
        hideLoading();
        return res;
      };
    }
  }

  return true;
}

/**
 * 8. Spriteset_Base.prototype.updateToneChanger (MV):
 * 화면 톤이 [0,0,0,0] 중립 상태일 때 ToneFilter를 필터 목록에서 제거해 풀스크린 2패스를 생략합니다.
 */
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

/**
 * 9. ColorFilter.prototype.initialize (MZ):
 * ColorFilter가 중립(hue 0, tone 0, blend alpha 0, brightness 255)일 때 enabled=false로 동작해 불필요한 패스를 생략합니다.
 */
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

/**
 * 10. Scene_MenuBase.prototype.createBackground (MZ):
 * 매 프레임 BlurFilter(8패스)를 돌리는 대신, 진입 시 1회만 블러 Bitmap을 생성해 재사용합니다.
 */
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

/**
 * 11. Scene_Battle.prototype.terminate:
 * 전투 종료 시 BattleManager가 붙잡고 있는 이전 전투의 PIXI DisplayObject 참조를 해제합니다.
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

/**
 * 12. Scene_Base.prototype.terminate:
 * 씬 종료 시 PIXI 렌더러 배치/필터 스택 및 종료된 씬을 붙잡는 전역 DisplayObject 참조를 정리합니다.
 */
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
      if (!(o instanceof DisplayObject)) continue;
      while (o.parent) o = o.parent;
      if (o === scene) {
        try { window[globalKeys[j]] = null; } catch (e) {}
      }
    }
    return r;
  };
  return true;
}

/**
 * 13. SceneManager.onSceneTerminate (MZ):
 * 전투 종료 시 전투 중에만 ImageManager._cache에 적재된 적/배경/얼굴 텍스처를 즉시 해제합니다.
 */
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

/**
 * 14. Game_Switches / Game_Variables / Game_SelfSwitches.setValue:
 * 실제로 값이 변경되었을 때만 onChange()($gameMap.requestRefresh)를 호출합니다.
 */
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

/**
 * 15. Sprite.prototype.update:
 * 매 프레임 children.forEach 클로저 할당을 단순 for 루프로 대체합니다.
 */
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

/**
 * 16. Game_Map.prototype.events:
 * _events 배열 구성이 변하지 않았으면 매 호출마다 새 배열을 할당하지 않고 캐시를 반환합니다.
 */
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

/**
 * 17. Tilemap.prototype._sortChildren:
 * 자식 스프라이트들이 이미 정렬되어 있으면 Array.prototype.sort 호출을 생략합니다.
 */
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

function setupEngineHooksModule(options = {}) {
  const { userOpt = {}, isMZ = false } = options;
  const registry = createOptimizationRegistry(userOpt.disableOptimizations || []);

  if (typeof window !== 'undefined') {
    window.__mkmvOptimizations = registry;
  }

  const installAll = () => {
    registry.register('windowlayer-skip-empty', 'Skip empty WindowLayer WebGL filter pass', applyWindowLayerSkipEmpty);
    registry.register('request-images-once', 'Cache Game_Interpreter.requestImages per command list', applyRequestImagesOnce);
    registry.register('skip-branch-table', 'O(1) jump table for Game_Interpreter.skipBranch', applySkipBranchTable);
    registry.register('yep-enemy-name-refresh', 'Fix YEP_BattleEngineCore enemy name redraw bug', applyYepEnemyNameRefresh);
    registry.register('yep-enemy-select-refresh', 'Skip redundant clear on hidden enemy select windows', applyYepEnemySelectRefresh);
    registry.register('refresh-if-same-drawing', 'Skip identical BattleStatus/BattleEnemy redraws', applyRefreshIfSameDrawing);
    registry.register('loading-notice', 'Show Loading... badge on long scene/load stalls', applyLoadingNotice);
    registry.register('battle-release', 'Release BattleManager DisplayObject references on terminate', applyBattleRelease);
    registry.register('scene-release', 'Clear PIXI batch/filter stack and global scene references on terminate', applySceneRelease);
    registry.register('refresh-if-changed', 'Only request map refresh when switch/variable values actually change', applyRefreshIfChanged);
    registry.register('sprite-update-loop', 'Replace Sprite.update children.forEach with plain for-loop', applySpriteUpdateLoop);
    registry.register('events-cached', 'Cache Game_Map.prototype.events array when unchanged', applyEventsCached);
    registry.register('sort-if-needed', 'Skip Tilemap._sortChildren when already sorted', applySortIfNeeded);

    if (isMZ) {
      registry.register('color-filter-identity-off', 'Disable neutral ColorFilter passes in MZ', applyColorFilterIdentityOff);
      registry.register('menu-blur-once', 'Cache MZ menu background BlurFilter result', applyMenuBlurOnce);
      registry.register('battle-images-release', 'Release MZ battle-only images on battle end', applyBattleImagesRelease);
    } else {
      registry.register('tone-filter-when-needed', 'Remove neutral ToneFilter from Spriteset_Base in MV', applyToneFilterWhenNeeded);
    }
  };

  installAll();

  if (typeof window !== 'undefined') {
    let cleanupTimer = null;
    const pollTimer = setInterval(() => {
      installAll();
    }, 100);
    cleanupTimer = setTimeout(() => {
      clearInterval(pollTimer);
    }, 20000);
    if (cleanupTimer && cleanupTimer.unref) cleanupTimer.unref();
    if (pollTimer && pollTimer.unref) pollTimer.unref();
  }

  return registry;
}

module.exports = {
  createOptimizationRegistry,
  setupEngineHooksModule,
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
};
