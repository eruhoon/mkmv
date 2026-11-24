/**
 * mkmv Audio Management & Recovery Module
 *
 * 기능:
 * 1. 알만툴 오디오 포커스 아웃 음소거 방지 (patchAudioFocus)
 *    - 창 포커스가 빠졌을 때 소리가 꺼지지 않도록 WebAudio._onVisibilityChange 및 AudioManager._onVisibilityChange 비활성화
 * 2. 슬립/화면 복귀 시 오디오 컨텍스트 자동 재개 (setupAudioRecovery)
 *    - 포커스 진입, 가시성 변경(visibilitychange), 키 입력 시 suspended 상태의 WebAudio._context.resume() 호출
 * 3. 알만툴 WebAudio & Html5Audio 오디오 리소스 유니코드 직접 복구 (setupUniversalAudioRecovery)
 *    - Chromium의 FileURLLoaderFactory 한계로 인해 유니코드/특수문자 파일명의 BGM/SE가 씹히는 문제 해결
 *    - Node.js fs 및 Blob URL을 통해 디스크에서 오디오 바이너리를 직접 주입
 */

const path = require('path');
const fs = require('fs');
const { createLogger } = require('./logger.js');
const { waitForCondition } = require('./bootstrap.js');
const { isVirtualBypassUrl, hasSpecialChars, isRpgmvHeader } = require('./fs-virtual.js');
const logger = createLogger('mkmv-audio');

function patchAudioFocus() {
  if (typeof window === 'undefined') return;

  if (window.WebAudio) {
    window.WebAudio._onVisibilityChange = function() {};
  }
  if (window.AudioManager) {
    window.AudioManager._onVisibilityChange = function() {};
  }
}

function setupAudioFocusGuard() {
  if (typeof window === 'undefined') return;

  waitForCondition(
    () => Boolean(window.WebAudio || window.AudioManager),
    patchAudioFocus,
    { intervalMs: 30, timeoutMs: 10000 }
  );
}

function setupAudioRecovery() {
  if (typeof window === 'undefined') return;

  function resumeAudioContext() {
    try {
      if (window.WebAudio && window.WebAudio._context && window.WebAudio._context.state === 'suspended') {
        window.WebAudio._context.resume().then(() => {
          logger.debug('WebAudio context resumed after sleep/focus');
        }).catch((e) => {
          logger.warn('WebAudio resume failed:', e);
        });
      }
    } catch (e) {}
  }

  window.addEventListener('focus', resumeAudioContext);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        resumeAudioContext();
      }
    });
  }
  window.addEventListener('keydown', resumeAudioContext, { capture: true, passive: true });
}

function setupUniversalAudioRecovery(options = {}) {
  if (typeof window === 'undefined') return;
  const { resolveGamePath, origExistsSync, origReadFileSync, assetCache } = options;

  waitForCondition(
    () => {
      let webAudioHooked = false;

      if (window.WebAudio && window.WebAudio.prototype && window.WebAudio.prototype._load) {
        if (!window.WebAudio.prototype._mkmvAudioHooked) {
          window.WebAudio.prototype._mkmvAudioHooked = true;
          const origWebAudioLoad = window.WebAudio.prototype._load;

          window.WebAudio.prototype._load = function(url) {
            if (isVirtualBypassUrl(url)) {
              return origWebAudioLoad.apply(this, arguments);
            }

            const isEncryptedAudio = window.Decrypter && window.Decrypter.hasEncryptedAudio;
            if (isEncryptedAudio && assetCache && assetCache.enabled && window.WebAudio._context) {
              const encUrl = url.replace(/\.ogg$/i, '.rpgmvo').replace(/\.m4a$/i, '.rpgmvm');
              const cachedAudio = assetCache.resolveCachedFile(encUrl) || assetCache.resolveCachedFile(url);
              if (cachedAudio && origExistsSync && origExistsSync(cachedAudio)) {
                try {
                  const buf = origReadFileSync(cachedAudio);
                  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                  logger.verbose(`Loaded decrypted WebAudio from cache: ${url}`);
                  this._onXhrLoad({ status: 200, response: arrayBuffer });
                  return;
                } catch (e) {}
              }
              if (fs.promises && typeof fs.promises.readFile === 'function') {
                const resolvedEnc = resolveGamePath ? resolveGamePath(encUrl) : null;
                if (resolvedEnc && origExistsSync && origExistsSync(resolvedEnc)) {
                  fs.promises.readFile(resolvedEnc)
                    .then((buf) => assetCache.decryptAndCacheBuffer(encUrl, buf))
                    .catch(() => {});
                }
              }
            }

            if (!isEncryptedAudio && hasSpecialChars(url) && window.WebAudio._context) {
              const resolved = resolveGamePath ? resolveGamePath(url) : null;
              const isEncryptedExt = resolved && (resolved.endsWith('.rpgmvo') || resolved.endsWith('.rpgmvm') || resolved.endsWith('.ogg_') || resolved.endsWith('.m4a_'));
              if (!isEncryptedExt && resolved && origExistsSync && origExistsSync(resolved)) {
                try {
                  const buf = origReadFileSync(resolved);
                  if (!isRpgmvHeader(buf)) {
                    logger.verbose(`Direct loading Unicode WebAudio via Node.js fs: ${url}`);
                    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                    this._onXhrLoad({ status: 200, response: arrayBuffer });
                    return;
                  }
                } catch (e) {
                  logger.error('Direct WebAudio load error:', e);
                }
              }
            }
            return origWebAudioLoad.apply(this, arguments);
          };
          webAudioHooked = true;
        }
      }

      if (window.Html5Audio && typeof window.Html5Audio._load === 'function') {
        if (!window.Html5Audio._mkmvAudioHooked) {
          window.Html5Audio._mkmvAudioHooked = true;
          const origHtml5Load = window.Html5Audio._load;

          window.Html5Audio._load = function(url) {
            if (isVirtualBypassUrl(url)) {
              return origHtml5Load.apply(this, arguments);
            }

            const isEncryptedAudio = window.Decrypter && window.Decrypter.hasEncryptedAudio;
            if (!isEncryptedAudio && hasSpecialChars(url) && this._audioElement) {
              const resolved = resolveGamePath ? resolveGamePath(url) : null;
              const isEncryptedExt = resolved && (resolved.endsWith('.rpgmvo') || resolved.endsWith('.rpgmvm') || resolved.endsWith('.ogg_') || resolved.endsWith('.m4a_'));
              if (!isEncryptedExt && resolved && origExistsSync && origExistsSync(resolved)) {
                try {
                  const buf = origReadFileSync(resolved);
                  if (!isRpgmvHeader(buf)) {
                    logger.verbose(`Direct loading Unicode Html5Audio via Blob: ${url}`);
                    const ext = path.extname(resolved).toLowerCase();
                    const mime = ext === '.ogg' ? 'audio/ogg' : (ext === '.m4a' ? 'audio/mp4' : 'audio/mpeg');
                    const blob = new Blob([buf], { type: mime });
                    const blobUrl = URL.createObjectURL(blob);
                    const audioEl = this._audioElement;
                    if (typeof audioEl.addEventListener === 'function') {
                      const revoke = () => {
                        try { URL.revokeObjectURL(blobUrl); } catch (e) {}
                        if (typeof audioEl.removeEventListener === 'function') {
                          audioEl.removeEventListener('loadeddata', revoke);
                          audioEl.removeEventListener('error', revoke);
                        }
                      };
                      audioEl.addEventListener('loadeddata', revoke);
                      audioEl.addEventListener('error', revoke);
                    }
                    this._isLoading = true;
                    audioEl.src = blobUrl;
                    audioEl.load();
                    return;
                  }
                } catch (e) {
                  logger.error('Direct Html5Audio load error:', e);
                }
              }
            }
            return origHtml5Load.apply(this, arguments);
          };
        }
      }

      if (webAudioHooked || (window.WebAudio && window.WebAudio.prototype && window.WebAudio.prototype._mkmvAudioHooked)) {
        logger.debug('Universal Audio recovery hooks installed successfully');
        return true;
      }
      return false;
    },
    null,
    { intervalMs: 50, timeoutMs: 30000, runImmediately: false }
  );
}

function setupAudioModule(options = {}) {
  setupAudioFocusGuard();
  setupAudioRecovery();
  setupUniversalAudioRecovery(options);
}

module.exports = {
  setupAudioModule,
  patchAudioFocus,
  setupAudioFocusGuard,
  setupAudioRecovery,
  setupUniversalAudioRecovery
};
