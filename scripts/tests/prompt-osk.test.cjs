const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  createHangulComposer,
  buildPromptHtml,
  setupPromptMain,
  setupPromptRenderer
} = require('../../template/modules/prompt-osk.js');

test('createHangulComposer composes syllables, double vowels, compound coda, and backspaces cleanly', () => {
  const c = createHangulComposer('');
  for (const ch of ['ㄱ', 'ㅏ', 'ㄴ']) c.inputJamo(ch);
  assert.equal(c.getText(), '간');

  c.inputJamo('ㅏ');
  assert.equal(c.getText(), '가나');

  c.setText('');
  for (const ch of ['ㅂ', 'ㅏ', 'ㄹ', 'ㄱ']) c.inputJamo(ch);
  assert.equal(c.getText(), '밝');
  c.inputJamo('ㅏ');
  assert.equal(c.getText(), '발가');

  c.setText('');
  for (const ch of ['ㄱ', 'ㅗ', 'ㅏ']) c.inputJamo(ch);
  assert.equal(c.getText(), '과');
  assert.equal(c.backspace(), '고');
  assert.equal(c.backspace(), 'ㄱ');
  assert.equal(c.backspace(), '');
});

test('buildPromptHtml generates self-contained OSK HTML with IPC bridge', () => {
  const html = buildPromptHtml();
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('__mkmvPromptBridge'));
  assert.ok(html.includes('createHangulComposer'));
});

test('setupPromptRenderer overrides window.prompt via ipcRenderer.sendSync and clears Input', () => {
  const origWindow = global.window;
  let clearCount = 0;
  const sent = [];

  global.window = {
    Input: { clear: () => { clearCount++; } }
  };

  try {
    const fakeIpc = {
      sendSync: (channel, payload) => {
        sent.push({ channel, payload });
        return 'Hero';
      }
    };
    const ok = setupPromptRenderer({ ipcRenderer: fakeIpc, userOpt: { gamepadProfile: 'nintendo' } });
    assert.equal(ok, true);
    const res = global.window.prompt('Name?', 'Alex');
    assert.equal(res, 'Hero');
    assert.equal(clearCount, 2);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].channel, 'mkmv-prompt-sync');
    assert.deepEqual(sent[0].payload, {
      message: 'Name?',
      defaultValue: 'Alex',
      gamepadProfile: 'nintendo'
    });
  } finally {
    global.window = origWindow;
  }
});

test('setupPromptMain opens modal BrowserWindow and resolves synchronous IPC on submit', () => {
  const ipcMain = new EventEmitter();
  let focusedMain = 0;
  let closedModal = false;
  let fullScreenState = true;
  let visibleState = true;
  const fullScreenHistory = [];
  const visibleHistory = [];
  const sentToModal = [];

  const fakeMainWin = {
    isDestroyed: () => false,
    isFullScreen: () => fullScreenState,
    setFullScreen: (v) => { fullScreenState = v; fullScreenHistory.push(v); },
    isVisible: () => visibleState,
    hide: () => { visibleState = false; visibleHistory.push(false); },
    show: () => { visibleState = true; visibleHistory.push(true); },
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
    focus: () => { focusedMain++; },
    webContents: { focus: () => { focusedMain++; } }
  };

  class FakeBrowserWindow extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this._destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.send = (ch, data) => sentToModal.push({ ch, data });
      this.webContents.focus = () => {};
    }
    isDestroyed() { return this._destroyed; }
    show() {}
    focus() {}
    close() { this._destroyed = true; closedModal = true; }
    loadURL() {
      this.webContents.emit('did-finish-load');
    }
  }

  setupPromptMain({
    ipcMain,
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWin
  });

  const syncEvent = { returnValue: undefined };
  ipcMain.emit('mkmv-prompt-sync', syncEvent, {
    message: 'Enter name',
    defaultValue: 'Alice',
    gamepadProfile: 'standard'
  });

  assert.equal(sentToModal.length, 1);
  assert.equal(sentToModal[0].ch, 'mkmv-prompt-data');
  assert.equal(sentToModal[0].data.message, 'Enter name');
  assert.equal(sentToModal[0].data.defaultValue, 'Alice');

  ipcMain.emit('mkmv-prompt-result', {}, 'Bob');
  assert.equal(syncEvent.returnValue, 'Bob');
  assert.equal(closedModal, true);
  assert.deepEqual(fullScreenHistory, [false, true]);
  assert.deepEqual(visibleHistory, [false, true]);
  assert.ok(focusedMain >= 2);
});
