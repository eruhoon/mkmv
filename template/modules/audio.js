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
const { createLogger } = require('./logger.js');
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

  let cleanupTimer = null;
  const audioPollTimer = setInterval(() => {
    if (window.WebAudio || window.AudioManager) {
      patchAudioFocus();
      clearInterval(audioPollTimer);
      if (cleanupTimer) clearTimeout(cleanupTimer);
    }
  }, 30);
  cleanupTimer = setTimeout(() => clearInterval(audioPollTimer), 10000);
  if (cleanupTimer && cleanupTimer.unref) cleanupTimer.unref();
  if (audioPollTimer && audioPollTimer.unref) audioPollTimer.unref();
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
  const { resolveGamePath, origExistsSync, origReadFileSync } = options;

  let cleanupTimer = null;
  const hookTimer = setInterval(() => {
    let webAudioHooked = false;
    let html5AudioHooked = false;

    if (window.WebAudio && window.WebAudio.prototype && window.WebAudio.prototype._load) {
      if (!window.WebAudio.prototype._mkmvAudioHooked) {
        window.WebAudio.prototype._mkmvAudioHooked = true;
        const origWebAudioLoad = window.WebAudio.prototype._load;

        window.WebAudio.prototype._load = function(url) {
          if (!url || typeof url !== 'string' || url.startsWith('data:') || url.startsWith('blob:')) {
            return origWebAudioLoad.apply(this, arguments);
          }

          const isEncryptedAudio = window.Decrypter && window.Decrypter.hasEncryptedAudio;
          const resolved = resolveGamePath ? resolveGamePath(url) : null;
          const exists = resolved && origExistsSync ? origExistsSync(resolved) : false;
          const isEncryptedExt = resolved && (resolved.endsWith('.rpgmvo') || resolved.endsWith('.rpgmvm') || resolved.endsWith('.ogg_') || resolved.endsWith('.m4a_'));
          const hasSpecial = /[^\x00-\x7F]/.test(url || '') || (resolved && /[^\x00-\x7F]/.test(resolved)) || (url && url.includes('%'));

          if (!isEncryptedAudio && !isEncryptedExt && hasSpecial && exists && window.WebAudio._context) {
            try {
              const buf = origReadFileSync(resolved);
              const isRpgmvHeader = buf.length >= 16 && buf[0] === 0x52 && buf[1] === 0x50 && buf[2] === 0x47 && buf[3] === 0x4D && buf[4] === 0x56;
              if (!isRpgmvHeader) {
                logger.verbose(`Direct loading Unicode WebAudio via Node.js fs: ${url}`);
                const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                this._onXhrLoad({ status: 200, response: arrayBuffer });
                return;
              }
            } catch (e) {
              logger.error('Direct WebAudio load error:', e);
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
          if (!url || typeof url !== 'string' || url.startsWith('data:') || url.startsWith('blob:')) {
            return origHtml5Load.apply(this, arguments);
          }

          const isEncryptedAudio = window.Decrypter && window.Decrypter.hasEncryptedAudio;
          const resolved = resolveGamePath ? resolveGamePath(url) : null;
          const exists = resolved && origExistsSync ? origExistsSync(resolved) : false;
          const isEncryptedExt = resolved && (resolved.endsWith('.rpgmvo') || resolved.endsWith('.rpgmvm') || resolved.endsWith('.ogg_') || resolved.endsWith('.m4a_'));
          const hasSpecial = /[^\x00-\x7F]/.test(url || '') || (resolved && /[^\x00-\x7F]/.test(resolved)) || (url && url.includes('%'));

          if (!isEncryptedAudio && !isEncryptedExt && hasSpecial && exists && this._audioElement) {
            try {
              const buf = origReadFileSync(resolved);
              const isRpgmvHeader = buf.length >= 16 && buf[0] === 0x52 && buf[1] === 0x50 && buf[2] === 0x47 && buf[3] === 0x4D && buf[4] === 0x56;
              if (!isRpgmvHeader) {
                logger.verbose(`Direct loading Unicode Html5Audio via Blob: ${url}`);
                const ext = path.extname(resolved).toLowerCase();
                const mime = ext === '.ogg' ? 'audio/ogg' : (ext === '.m4a' ? 'audio/mp4' : 'audio/mpeg');
                const blob = new Blob([buf], { type: mime });
                this._isLoading = true;
                this._audioElement.src = URL.createObjectURL(blob);
                this._audioElement.load();
                return;
              }
            } catch (e) {
              logger.error('Direct Html5Audio load error:', e);
            }
          }
          return origHtml5Load.apply(this, arguments);
        };
        html5AudioHooked = true;
      }
    }

    if (webAudioHooked || (window.WebAudio && window.WebAudio.prototype && window.WebAudio.prototype._mkmvAudioHooked)) {
      clearInterval(hookTimer);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      logger.debug('Universal Audio recovery hooks installed successfully');
    }
  }, 50);
  cleanupTimer = setTimeout(() => clearInterval(hookTimer), 30000);
  if (cleanupTimer && cleanupTimer.unref) cleanupTimer.unref();
  if (hookTimer && hookTimer.unref) hookTimer.unref();
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
