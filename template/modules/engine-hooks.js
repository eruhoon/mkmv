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
const { waitForCondition } = require('./bootstrap.js');
const {
  applyWindowLayerSkipEmpty,
  applyToneFilterWhenNeeded,
  applyColorFilterIdentityOff,
  applyMenuBlurOnce,
  applySortIfNeeded
} = require('./hooks/render.js');
const {
  applyRequestImagesOnce,
  applySkipBranchTable,
  applyRefreshIfChanged,
  applySpriteUpdateLoop,
  applyEventsCached
} = require('./hooks/interpreter.js');
const {
  applyYepEnemyNameRefresh,
  applyYepEnemySelectRefresh,
  applyRefreshIfSameDrawing
} = require('./hooks/plugins-compat.js');
const {
  applyBattleRelease,
  applySceneRelease,
  applyBattleImagesRelease
} = require('./hooks/memory-release.js');
const { applyLoadingNotice } = require('./hooks/loading-ui.js');

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
    waitForCondition(
      () => {
        installAll();
        return false;
      },
      null,
      { intervalMs: 100, timeoutMs: 20000, runImmediately: false }
    );
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
