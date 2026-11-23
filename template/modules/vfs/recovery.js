/**
 * mkmv VFS Network & DataManager Unicode Recovery
 */

const fs = require('fs');
const { createLogger } = require('../logger.js');
const { waitForCondition } = require('../bootstrap.js');
const {
  getActiveGameDir,
  resolveGamePath,
  isVirtualBypassUrl,
  hasSpecialChars,
  origExistsSync,
  origReadFileSync
} = require('./path-resolver.js');

const logger = createLogger('mkmv-vfs');

function setupUniversalXhrRecovery(baseDir = getActiveGameDir()) {
  if (typeof XMLHttpRequest === 'undefined') return;
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  function fulfillXhr(targetXhr, resolvedPath, preloadedBuf = null) {
    try {
      const isArrayBuffer = targetXhr.responseType === 'arraybuffer';
      const isJson = targetXhr.responseType === 'json';
      const isBlob = targetXhr.responseType === 'blob';

      let responseData;
      let responseText = '';
      const rawBuf = preloadedBuf || origReadFileSync.call(fs, resolvedPath);

      if (isArrayBuffer) {
        responseData = rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength);
      } else if (isBlob) {
        responseData = new Blob([rawBuf]);
      } else {
        responseText = rawBuf.toString('utf8').replace(/^\uFEFF/, '');
        if (isJson) {
          try {
            responseData = JSON.parse(responseText);
          } catch (e) {
            responseData = null;
          }
        } else {
          responseData = responseText;
        }
      }

      Object.defineProperty(targetXhr, 'readyState', { value: 4, writable: false, configurable: true });
      Object.defineProperty(targetXhr, 'status', { value: 200, writable: false, configurable: true });
      Object.defineProperty(targetXhr, 'statusText', { value: 'OK', writable: false, configurable: true });
      Object.defineProperty(targetXhr, 'response', { value: responseData, writable: false, configurable: true });
      if (!isArrayBuffer && !isBlob) {
        Object.defineProperty(targetXhr, 'responseText', { value: responseText, writable: false, configurable: true });
      }

      if (typeof targetXhr.onreadystatechange === 'function') {
        targetXhr.onreadystatechange();
      }
      targetXhr.dispatchEvent(new Event('readystatechange'));

      if (typeof targetXhr.onload === 'function') {
        targetXhr.onload();
      }
      targetXhr.dispatchEvent(new ProgressEvent('load'));

      if (typeof targetXhr.onloadend === 'function') {
        targetXhr.onloadend();
      }
      targetXhr.dispatchEvent(new ProgressEvent('loadend'));
    } catch (err) {
      logger.error('XHR direct fulfill error:', err);
      if (typeof targetXhr.onerror === 'function') {
        targetXhr.onerror();
      }
      targetXhr.dispatchEvent(new ProgressEvent('error'));
    }
  }

  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    this._mkmvMethod = (method || 'GET').toUpperCase();
    this._mkmvUrl = url;
    this._mkmvAsync = async !== false;
    return origOpen.apply(this, arguments);
  };

  const baseHasSpecial = hasSpecialChars(baseDir);

  XMLHttpRequest.prototype.send = function(body) {
    const url = this._mkmvUrl;
    const method = this._mkmvMethod;

    if (method === 'GET' && !isVirtualBypassUrl(url) && !url.startsWith('http://') && !url.startsWith('https://')) {
      if (baseHasSpecial || hasSpecialChars(url)) {
        const resolved = resolveGamePath(url, baseDir);
        if (resolved && origExistsSync.call(fs, resolved)) {
          if (this._mkmvAsync === false) {
            fulfillXhr(this, resolved);
            return;
          }
          const self = this;
          if (fs.promises && typeof fs.promises.readFile === 'function') {
            fs.promises.readFile(resolved).then((buf) => {
              fulfillXhr(self, resolved, buf);
            }).catch((err) => {
              logger.error('Async XHR direct read error:', err);
              if (typeof self.onerror === 'function') self.onerror();
              self.dispatchEvent(new ProgressEvent('error'));
            });
          } else {
            setTimeout(() => {
              fulfillXhr(self, resolved);
            }, 0);
          }
          return;
        }
      }
    }

    return origSend.apply(this, arguments);
  };

  if (typeof window !== 'undefined' && window.fetch) {
    const origFetch = window.fetch;
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      if (!isVirtualBypassUrl(url) && !url.startsWith('http://') && !url.startsWith('https://')) {
        if (baseHasSpecial || hasSpecialChars(url)) {
          const resolved = resolveGamePath(url, baseDir);
          if (resolved && origExistsSync.call(fs, resolved)) {
            if (fs.promises && typeof fs.promises.readFile === 'function') {
              return fs.promises.readFile(resolved)
                .then((buf) => new Response(buf, { status: 200, statusText: 'OK' }))
                .catch(() => origFetch.apply(this, arguments));
            }
            try {
              const buf = origReadFileSync.call(fs, resolved);
              return Promise.resolve(new Response(buf, { status: 200, statusText: 'OK' }));
            } catch (e) {}
          }
        }
      }
      return origFetch.apply(this, arguments);
    };
  }

  logger.debug('Universal XHR & Fetch Unicode recovery installed');
}

function setupDataManagerRecovery(baseDir = getActiveGameDir()) {
  if (typeof window === 'undefined') return;
  const baseHasSpecial = hasSpecialChars(baseDir);

  waitForCondition(
    () => Boolean(window.DataManager && typeof window.DataManager.loadDataFile === 'function'),
    () => {
      if (window.DataManager._mkmvDataHooked) return;
      window.DataManager._mkmvDataHooked = true;
      const origLoadDataFile = window.DataManager.loadDataFile;
      window.DataManager.loadDataFile = function(name, src) {
        if (baseHasSpecial || hasSpecialChars(src)) {
          const dataUrl = 'data/' + src;
          const resolved = resolveGamePath(dataUrl, baseDir);
          if (resolved && origExistsSync.call(fs, resolved)) {
            try {
              logger.verbose(`Direct loading Unicode DataFile via Node.js fs: ${src}`);
              const content = origReadFileSync.call(fs, resolved, 'utf8');
              window[name] = JSON.parse(content.replace(/^\uFEFF/, ''));
              DataManager.onLoad(window[name]);
              return;
            } catch (e) {
              logger.error('Direct DataFile load error:', e);
            }
          }
        }
        return origLoadDataFile.apply(this, arguments);
      };
      logger.debug('DataManager unicode recovery hook installed successfully');
    },
    { intervalMs: 50, timeoutMs: 30000 }
  );
}

module.exports = {
  setupUniversalXhrRecovery,
  setupDataManagerRecovery
};
