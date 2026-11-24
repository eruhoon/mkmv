/**
 * mkmv Prompt OSK Modal Preload
 *
 * OSK 모달 창(data:text/html)과 메인 프로세스 간 IPC 브리지를 제공합니다.
 */

const { ipcRenderer } = require('electron');

window.__mkmvPromptBridge = {
  onInit: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.once('mkmv-prompt-data', (_event, data) => {
      callback(data || {});
    });
  },
  submit: (value) => {
    ipcRenderer.send('mkmv-prompt-result', value === undefined ? null : value);
  }
};
