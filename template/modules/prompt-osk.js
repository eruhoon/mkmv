/**
 * mkmv Synchronous Prompt & On-Screen Keyboard (OSK) Module
 *
 * Electron에서 미지원되는 window.prompt()를 ipcRenderer.sendSync + 모달 OSK 창으로 대체합니다.
 * 게임패드(gptokeyb 키보드 매핑 및 네이티브 Gamepad API)와 터치 입력을 모두 지원하며,
 * 영문/숫자/기호 및 두벌식 한글 조합을 내장합니다.
 */

const path = require('path');
const { createLogger } = require('./logger.js');

const logger = createLogger('mkmv-prompt');

/**
 * 순수 JS 두벌식 한글 조합기 (OSK 및 단위 테스트 공용)
 */
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

const VOWEL_COMBINE = {
  'ㅗ|ㅏ': 'ㅘ', 'ㅗ|ㅐ': 'ㅙ', 'ㅗ|ㅣ': 'ㅚ',
  'ㅜ|ㅓ': 'ㅝ', 'ㅜ|ㅔ': 'ㅞ', 'ㅜ|ㅣ': 'ㅟ',
  'ㅡ|ㅣ': 'ㅢ'
};
const VOWEL_SPLIT = {
  'ㅘ': ['ㅗ', 'ㅏ'], 'ㅙ': ['ㅗ', 'ㅐ'], 'ㅚ': ['ㅗ', 'ㅣ'],
  'ㅝ': ['ㅜ', 'ㅓ'], 'ㅞ': ['ㅜ', 'ㅔ'], 'ㅟ': ['ㅜ', 'ㅣ'],
  'ㅢ': ['ㅡ', 'ㅣ']
};
const JONG_COMBINE = {
  'ㄱ|ㅅ': 'ㄳ', 'ㄴ|ㅈ': 'ㄵ', 'ㄴ|ㅎ': 'ㄶ',
  'ㄹ|ㄱ': 'ㄺ', 'ㄹ|ㅁ': 'ㄻ', 'ㄹ|ㅂ': 'ㄼ', 'ㄹ|ㅅ': 'ㄽ', 'ㄹ|ㅌ': 'ㄾ', 'ㄹ|ㅍ': 'ㄿ', 'ㄹ|ㅎ': 'ㅀ',
  'ㅂ|ㅅ': 'ㅄ'
};
const JONG_SPLIT = {
  'ㄳ': ['ㄱ', 'ㅅ'], 'ㄵ': ['ㄴ', 'ㅈ'], 'ㄶ': ['ㄴ', 'ㅎ'],
  'ㄺ': ['ㄹ', 'ㄱ'], 'ㄻ': ['ㄹ', 'ㅁ'], 'ㄼ': ['ㄹ', 'ㅂ'], 'ㄽ': ['ㄹ', 'ㅅ'], 'ㄾ': ['ㄹ', 'ㅌ'], 'ㄿ': ['ㄹ', 'ㅍ'], 'ㅀ': ['ㄹ', 'ㅎ'],
  'ㅄ': ['ㅂ', 'ㅅ']
};

function composeHangulSyllable(choIdx, jungIdx, jongIdx = 0) {
  return String.fromCharCode(0xAC00 + (choIdx * 21 * 28) + (jungIdx * 28) + jongIdx);
}

function decomposeHangulSyllable(ch) {
  if (!ch || ch.length !== 1) return null;
  const code = ch.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return null;
  const offset = code - 0xAC00;
  const choIdx = Math.floor(offset / (21 * 28));
  const jungIdx = Math.floor((offset % (21 * 28)) / 28);
  const jongIdx = offset % 28;
  return { choIdx, jungIdx, jongIdx };
}

function createHangulComposer(initialText = '') {
  let committed = String(initialText || '');
  let state = null; // { choIdx, jungIdx, jongIdx } 또는 { choOnlyIdx }

  function getComposingChar() {
    if (!state) return '';
    if (state.choOnlyIdx !== undefined) return CHO[state.choOnlyIdx];
    return composeHangulSyllable(state.choIdx, state.jungIdx, state.jongIdx || 0);
  }

  function flush() {
    if (state) {
      committed += getComposingChar();
      state = null;
    }
    return committed;
  }

  function inputJamo(jamo) {
    const choIdx = CHO.indexOf(jamo);
    const jungIdx = JUNG.indexOf(jamo);

    if (choIdx === -1 && jungIdx === -1) {
      flush();
      committed += jamo;
      return getText();
    }

    if (jungIdx !== -1) {
      // 모음 입력
      if (!state) {
        committed += jamo;
        return getText();
      }
      if (state.choOnlyIdx !== undefined) {
        state = { choIdx: state.choOnlyIdx, jungIdx, jongIdx: 0 };
        return getText();
      }
      if (state.jongIdx === 0) {
        const combined = VOWEL_COMBINE[`${JUNG[state.jungIdx]}|${jamo}`];
        if (combined) {
          state.jungIdx = JUNG.indexOf(combined);
          return getText();
        }
        flush();
        committed += jamo;
        return getText();
      }
      // 종성이 있는 상태에서 모음이 들어오면 종성을 다음 초성으로 넘김 (도깨비불)
      const jongChar = JONG[state.jongIdx];
      const splitJong = JONG_SPLIT[jongChar];
      let nextChoChar = jongChar;
      if (splitJong) {
        state.jongIdx = JONG.indexOf(splitJong[0]);
        nextChoChar = splitJong[1];
      } else {
        state.jongIdx = 0;
      }
      const nextChoIdx = CHO.indexOf(nextChoChar);
      committed += composeHangulSyllable(state.choIdx, state.jungIdx, state.jongIdx);
      if (nextChoIdx !== -1) {
        state = { choIdx: nextChoIdx, jungIdx, jongIdx: 0 };
      } else {
        state = null;
        committed += nextChoChar + jamo;
      }
      return getText();
    }

    // 자음 입력
    if (!state) {
      state = { choOnlyIdx: choIdx };
      return getText();
    }
    if (state.choOnlyIdx !== undefined) {
      committed += CHO[state.choOnlyIdx];
      state = { choOnlyIdx: choIdx };
      return getText();
    }
    if (state.jongIdx === 0) {
      const asJong = JONG.indexOf(jamo);
      if (asJong > 0) {
        state.jongIdx = asJong;
        return getText();
      }
      flush();
      state = { choOnlyIdx: choIdx };
      return getText();
    }
    const combinedJong = JONG_COMBINE[`${JONG[state.jongIdx]}|${jamo}`];
    if (combinedJong) {
      state.jongIdx = JONG.indexOf(combinedJong);
      return getText();
    }
    flush();
    state = { choOnlyIdx: choIdx };
    return getText();
  }

  function backspace() {
    if (!state) {
      if (committed.length > 0) {
        committed = committed.slice(0, -1);
      }
      return getText();
    }
    if (state.choOnlyIdx !== undefined) {
      state = null;
      return getText();
    }
    if (state.jongIdx > 0) {
      const jongChar = JONG[state.jongIdx];
      const splitJong = JONG_SPLIT[jongChar];
      state.jongIdx = splitJong ? JONG.indexOf(splitJong[0]) : 0;
      return getText();
    }
    const jungChar = JUNG[state.jungIdx];
    const splitVowel = VOWEL_SPLIT[jungChar];
    if (splitVowel) {
      state.jungIdx = JUNG.indexOf(splitVowel[0]);
      return getText();
    }
    state = { choOnlyIdx: state.choIdx };
    return getText();
  }

  function setText(nextText) {
    committed = String(nextText || '');
    state = null;
    return committed;
  }

  function getText() {
    return committed + getComposingChar();
  }

  return { inputJamo, backspace, flush, setText, getText };
}

/**
 * OSK 모달 창에 로드할 자체 완결형 HTML UI 생성
 */
function buildPromptHtml() {
  const composerSource = [
    `const CHO = ${JSON.stringify(CHO)};`,
    `const JUNG = ${JSON.stringify(JUNG)};`,
    `const JONG = ${JSON.stringify(JONG)};`,
    `const VOWEL_COMBINE = ${JSON.stringify(VOWEL_COMBINE)};`,
    `const VOWEL_SPLIT = ${JSON.stringify(VOWEL_SPLIT)};`,
    `const JONG_COMBINE = ${JSON.stringify(JONG_COMBINE)};`,
    `const JONG_SPLIT = ${JSON.stringify(JONG_SPLIT)};`,
    composeHangulSyllable.toString(),
    createHangulComposer.toString()
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>Input</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%; height: 100%;
    background: #020617;
    color: #f8fafc;
    font-family: 'Noto Sans CJK KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
    overflow: hidden;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .wrap {
    display: flex; flex-direction: column;
    width: min(720px, 94vw); height: min(420px, 90vh);
    padding: 12px 14px;
    border: 2px solid #38bdf8;
    border-radius: 10px;
    background: linear-gradient(180deg, #111827 0%, #0f172a 100%);
    gap: 8px;
  }
  .header {
    display: flex; justify-content: space-between; align-items: center;
    gap: 8px; min-height: 24px;
  }
  .msg {
    font-size: 14px; font-weight: 600; color: #e2e8f0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .mode-tabs { display: flex; gap: 4px; flex-shrink: 0; }
  .tab {
    padding: 3px 9px; border-radius: 5px;
    font-size: 12px; font-weight: 700;
    background: #1e293b; color: #94a3b8;
    border: 1px solid #334155; cursor: pointer;
  }
  .tab.active {
    background: #0284c7; color: #ffffff; border-color: #38bdf8;
  }
  .input-box {
    display: flex; align-items: center;
    min-height: 40px; padding: 6px 12px;
    background: #020617;
    border: 2px solid #334155; border-radius: 7px;
    font-size: 18px; font-weight: 600; letter-spacing: 0.5px;
    color: #f8fafc; overflow-x: auto; white-space: pre;
  }
  .cursor {
    display: inline-block; width: 2px; height: 20px;
    background: #38bdf8; margin-left: 1px;
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }
  .kb {
    flex: 1; display: flex; flex-direction: column;
    justify-content: center; gap: 5px;
  }
  .row {
    display: flex; gap: 5px; flex: 1;
  }
  .key {
    flex: 1; display: flex; align-items: center; justify-content: center;
    background: #1e293b; color: #f1f5f9;
    border: 1px solid #334155; border-radius: 6px;
    font-size: 15px; font-weight: 600;
    cursor: pointer; min-width: 0;
  }
  .key.wide { flex: 1.5; font-size: 13px; background: #263449; }
  .key.space { flex: 3; font-size: 13px; background: #263449; }
  .key.ok { background: #0369a1; border-color: #0ea5e9; color: #fff; flex: 1.6; font-size: 13px; }
  .key.cancel { background: #7f1d1d; border-color: #ef4444; color: #fecaca; flex: 1.4; font-size: 13px; }
  .key.shift-on { background: #4338ca; border-color: #818cf8; color: #fff; }
  .key.focused {
    outline: 2px solid #38bdf8;
    background: #0ea5e9 !important;
    color: #020617 !important;
    border-color: #bae6fd !important;
    transform: scale(1.03);
  }
  .hint {
    font-size: 11px; color: #94a3b8;
    display: flex; justify-content: space-between;
    padding-top: 2px;
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div id="prompt-msg" class="msg">Input Text</div>
    <div class="mode-tabs">
      <button class="tab" data-mode="ko">한글</button>
      <button class="tab" data-mode="en">ABC</button>
      <button class="tab" data-mode="sym">123</button>
    </div>
  </div>
  <div id="input-box" class="input-box"><span id="input-text"></span><span class="cursor"></span></div>
  <div id="kb" class="kb"></div>
  <div class="hint">
    <span>D-Pad: Move | A(Z): Type | B(X): Back | L1/R1: Mode</span>
    <span>START(Enter): OK | SEL(Esc): Cancel</span>
  </div>
</div>
<script>
(function() {
  ${composerSource}

  const LAYOUTS = {
    en: {
      normal: [
        ['1','2','3','4','5','6','7','8','9','0'],
        ['q','w','e','r','t','y','u','i','o','p'],
        ['a','s','d','f','g','h','j','k','l','-'],
        [{id:'shift',label:'Shift',cls:'wide'},'z','x','c','v','b','n','m',{id:'back',label:'←',cls:'wide'}],
        [{id:'mode',label:'한/영',cls:'wide'},{id:'space',label:'Space',cls:'space'},{id:'clear',label:'Clear',cls:'wide'},{id:'cancel',label:'Cancel',cls:'cancel'},{id:'ok',label:'OK',cls:'ok'}]
      ],
      shift: [
        ['!','@','#','$','%','^','&','*','(',')'],
        ['Q','W','E','R','T','Y','U','I','O','P'],
        ['A','S','D','F','G','H','J','K','L','_'],
        [{id:'shift',label:'SHIFT',cls:'wide shift-on'},'Z','X','C','V','B','N','M',{id:'back',label:'←',cls:'wide'}],
        [{id:'mode',label:'한/영',cls:'wide'},{id:'space',label:'Space',cls:'space'},{id:'clear',label:'Clear',cls:'wide'},{id:'cancel',label:'Cancel',cls:'cancel'},{id:'ok',label:'OK',cls:'ok'}]
      ]
    },
    ko: {
      normal: [
        ['1','2','3','4','5','6','7','8','9','0'],
        ['ㅂ','ㅈ','ㄷ','ㄱ','ㅅ','ㅛ','ㅕ','ㅑ','ㅐ','ㅔ'],
        ['ㅁ','ㄴ','ㅇ','ㄹ','ㅎ','ㅗ','ㅓ','ㅏ','ㅣ','-'],
        [{id:'shift',label:'쌍자음',cls:'wide'},'ㅋ','ㅌ','ㅊ','ㅍ','ㅠ','ㅜ','ㅡ',{id:'back',label:'←',cls:'wide'}],
        [{id:'mode',label:'한/영',cls:'wide'},{id:'space',label:'Space',cls:'space'},{id:'clear',label:'Clear',cls:'wide'},{id:'cancel',label:'Cancel',cls:'cancel'},{id:'ok',label:'OK',cls:'ok'}]
      ],
      shift: [
        ['!','@','#','$','%','^','&','*','(',')'],
        ['ㅃ','ㅉ','ㄸ','ㄲ','ㅆ','ㅛ','ㅕ','ㅑ','ㅒ','ㅖ'],
        ['ㅁ','ㄴ','ㅇ','ㄹ','ㅎ','ㅗ','ㅓ','ㅏ','ㅣ','_'],
        [{id:'shift',label:'쌍자음',cls:'wide shift-on'},'ㅋ','ㅌ','ㅊ','ㅍ','ㅠ','ㅜ','ㅡ',{id:'back',label:'←',cls:'wide'}],
        [{id:'mode',label:'한/영',cls:'wide'},{id:'space',label:'Space',cls:'space'},{id:'clear',label:'Clear',cls:'wide'},{id:'cancel',label:'Cancel',cls:'cancel'},{id:'ok',label:'OK',cls:'ok'}]
      ]
    },
    sym: {
      normal: [
        ['1','2','3','4','5','6','7','8','9','0'],
        ['!','@','#','$','%','^','&','*','(',')'],
        ['-','_','=','+','[',']','{','}','\\\\','|'],
        [';',':','\\'', '\"',',','.','/','?','<','>'],
        [{id:'mode',label:'한/영',cls:'wide'},{id:'space',label:'Space',cls:'space'},{id:'back',label:'←',cls:'wide'},{id:'cancel',label:'Cancel',cls:'cancel'},{id:'ok',label:'OK',cls:'ok'}]
      ]
    }
  };

  const MODES = ['ko', 'en', 'sym'];
  let mode = 'ko';
  let shifted = false;
  let focusRow = 1;
  let focusCol = 0;
  let submitted = false;
  let gamepadProfile = 'auto';
  const composer = createHangulComposer('');

  const msgEl = document.getElementById('prompt-msg');
  const textEl = document.getElementById('input-text');
  const kbEl = document.getElementById('kb');
  const tabs = Array.from(document.querySelectorAll('.tab'));

  function getRows() {
    const layout = LAYOUTS[mode] || LAYOUTS.en;
    return (shifted && layout.shift) ? layout.shift : layout.normal;
  }

  function clampFocus() {
    const rows = getRows();
    if (focusRow < 0) focusRow = rows.length - 1;
    if (focusRow >= rows.length) focusRow = 0;
    const cols = rows[focusRow].length;
    if (focusCol < 0) focusCol = cols - 1;
    if (focusCol >= cols) focusCol = 0;
  }

  function finish(val) {
    if (submitted) return;
    submitted = true;
    const result = val === null ? null : composer.flush();
    if (window.__mkmvPromptBridge) {
      window.__mkmvPromptBridge.submit(val === null ? null : result);
    }
  }

  function handleKeyItem(item) {
    if (typeof item === 'string') {
      if (mode === 'ko') composer.inputJamo(item);
      else {
        composer.flush();
        composer.setText(composer.getText() + item);
      }
      if (shifted) shifted = false;
      render();
      return;
    }
    switch (item.id) {
      case 'shift':
        shifted = !shifted;
        render();
        break;
      case 'back':
        composer.backspace();
        render();
        break;
      case 'space':
        composer.flush();
        composer.setText(composer.getText() + ' ');
        render();
        break;
      case 'clear':
        composer.setText('');
        render();
        break;
      case 'mode':
        cycleMode(1);
        break;
      case 'cancel':
        finish(null);
        break;
      case 'ok':
        finish(composer.getText());
        break;
    }
  }

  function cycleMode(dir) {
    composer.flush();
    const idx = MODES.indexOf(mode);
    mode = MODES[(idx + dir + MODES.length) % MODES.length];
    shifted = false;
    clampFocus();
    render();
  }

  function render() {
    textEl.textContent = composer.getText();
    const box = document.getElementById('input-box');
    box.scrollLeft = box.scrollWidth;

    tabs.forEach((t) => {
      t.classList.toggle('active', t.getAttribute('data-mode') === mode);
    });

    const rows = getRows();
    clampFocus();
    kbEl.innerHTML = '';
    rows.forEach((row, rIdx) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'row';
      row.forEach((item, cIdx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isObj = typeof item === 'object';
        btn.className = 'key' + (isObj && item.cls ? ' ' + item.cls : '');
        if (rIdx === focusRow && cIdx === focusCol) btn.className += ' focused';
        btn.textContent = isObj ? item.label : item;
        btn.addEventListener('click', () => {
          focusRow = rIdx;
          focusCol = cIdx;
          handleKeyItem(item);
        });
        rowEl.appendChild(btn);
      });
      kbEl.appendChild(rowEl);
    });
  }

  tabs.forEach((t) => {
    t.addEventListener('click', () => {
      composer.flush();
      mode = t.getAttribute('data-mode') || 'en';
      shifted = false;
      render();
    });
  });

  function moveFocus(dr, dc) {
    const rows = getRows();
    if (dr !== 0) {
      focusRow = (focusRow + dr + rows.length) % rows.length;
      if (focusCol >= rows[focusRow].length) focusCol = rows[focusRow].length - 1;
    }
    if (dc !== 0) {
      const len = rows[focusRow].length;
      focusCol = (focusCol + dc + len) % len;
    }
    render();
  }

  window.addEventListener('keydown', (e) => {
    const key = e.key || '';
    const upper = key.toUpperCase();
    if (key === 'ArrowUp') { e.preventDefault(); moveFocus(-1, 0); return; }
    if (key === 'ArrowDown') { e.preventDefault(); moveFocus(1, 0); return; }
    if (key === 'ArrowLeft') { e.preventDefault(); moveFocus(0, -1); return; }
    if (key === 'ArrowRight') { e.preventDefault(); moveFocus(0, 1); return; }
    if (key === 'Enter') { e.preventDefault(); finish(composer.getText()); return; }
    if (key === 'Escape') { e.preventDefault(); finish(null); return; }
    if (key === 'PageUp') { e.preventDefault(); cycleMode(-1); return; }
    if (key === 'PageDown') { e.preventDefault(); cycleMode(1); return; }
    if (key === 'Backspace') { e.preventDefault(); composer.backspace(); render(); return; }
    if (key === 'Shift') { e.preventDefault(); shifted = !shifted; render(); return; }
    if (key === ' ') { e.preventDefault(); composer.flush(); composer.setText(composer.getText() + ' '); render(); return; }

    // gptokeyb A/B 매핑 (z/x)
    if (upper === 'Z' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const rows = getRows();
      handleKeyItem(rows[focusRow][focusCol]);
      return;
    }
    if (upper === 'X' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      composer.backspace();
      render();
      return;
    }
    // 물리 키보드 직접 입력 지원 (1글자 출력 문자)
    if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      composer.flush();
      composer.setText(composer.getText() + key);
      render();
    }
  });

  // 네이티브 게임패드 폴링 (disableNativeGamepad=false 환경용)
  const prevBtns = Object.create(null);
  function pollGamepads() {
    if (submitted) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || !p.connected || !p.buttons) continue;
      const id = (p.id || '').toLowerCase();
      const isRetro = gamepadProfile === 'retrogame_joypad' || (gamepadProfile === 'auto' && (id.includes('retrogame_joypad') || id.includes('484b') || id.includes('singleadc')));
      const isNin = gamepadProfile === 'nintendo';
      const btnMap = isRetro
        ? { cancel: 0, ok: 1, shift: 2, space: 3, l1: 4, r1: 5, sel: 8, start: 9, up: 13, down: 14, left: 15, right: 16 }
        : isNin
        ? { cancel: 0, ok: 1, space: 2, shift: 3, l1: 4, r1: 5, sel: 8, start: 9, up: 12, down: 13, left: 14, right: 15 }
        : { ok: 0, cancel: 1, shift: 2, space: 3, l1: 4, r1: 5, sel: 8, start: 9, up: 12, down: 13, left: 14, right: 15 };

      const check = (action, cb) => {
        const idx = btnMap[action];
        const b = p.buttons[idx];
        const down = Boolean(b && (b.pressed || b.value > 0.5));
        const key = i + ':' + action;
        if (down && !prevBtns[key]) cb();
        prevBtns[key] = down;
      };
      check('up', () => moveFocus(-1, 0));
      check('down', () => moveFocus(1, 0));
      check('left', () => moveFocus(0, -1));
      check('right', () => moveFocus(0, 1));
      check('ok', () => handleKeyItem(getRows()[focusRow][focusCol]));
      check('cancel', () => { composer.backspace(); render(); });
      check('shift', () => { shifted = !shifted; render(); });
      check('space', () => { composer.flush(); composer.setText(composer.getText() + ' '); render(); });
      check('l1', () => cycleMode(-1));
      check('r1', () => cycleMode(1));
      check('start', () => finish(composer.getText()));
      check('sel', () => finish(null));
      break;
    }
  }
  setInterval(pollGamepads, 50);

  if (window.__mkmvPromptBridge) {
    window.__mkmvPromptBridge.onInit((data) => {
      if (data && data.message) msgEl.textContent = String(data.message);
      if (data && data.defaultValue) composer.setText(String(data.defaultValue));
      if (data && data.gamepadProfile) gamepadProfile = data.gamepadProfile;
      render();
    });
  }
  render();
})();
</script>
</body>
</html>`;
}

/**
 * 메인 프로세스 측: ipcMain 'mkmv-prompt-sync' 핸들러 등록
 */
function setupPromptMain({ ipcMain, BrowserWindow, getMainWindow, logger: extLogger } = {}) {
  if (!ipcMain || !BrowserWindow) return;
  const log = extLogger || logger;
  let activePromptWin = null;

  ipcMain.on('mkmv-prompt-sync', (event, payload = {}) => {
    if (activePromptWin && !activePromptWin.isDestroyed()) {
      log.warn('Ignoring overlapping window.prompt() call');
      event.returnValue = payload && payload.defaultValue != null ? String(payload.defaultValue) : null;
      return;
    }

    const mainWin = typeof getMainWindow === 'function' ? getMainWindow() : null;
    let width = 640;
    let height = 380;
    let x;
    let y;
    let wasFullScreen = false;
    let wasVisible = false;

    if (mainWin && !mainWin.isDestroyed()) {
      try {
        const bounds = mainWin.getBounds();
        width = Math.max(320, bounds.width || 640);
        height = Math.max(240, bounds.height || 380);
        x = bounds.x;
        y = bounds.y;
        wasFullScreen = typeof mainWin.isFullScreen === 'function' ? mainWin.isFullScreen() : false;
        wasVisible = typeof mainWin.isVisible === 'function' ? mainWin.isVisible() : true;
        if (wasFullScreen && typeof mainWin.setFullScreen === 'function') {
          mainWin.setFullScreen(false);
        }
        if (wasVisible && typeof mainWin.hide === 'function') {
          mainWin.hide();
        }
      } catch (e) {}
    }

    let settled = false;
    let promptWin = null;

    const finishPrompt = (result) => {
      if (settled) return;
      settled = true;
      activePromptWin = null;
      event.returnValue = result;
      if (promptWin && !promptWin.isDestroyed()) {
        try { promptWin.close(); } catch (e) {}
      }
      if (mainWin && !mainWin.isDestroyed()) {
        try {
          if (wasVisible && typeof mainWin.show === 'function') {
            mainWin.show();
          }
          if (wasFullScreen && typeof mainWin.setFullScreen === 'function') {
            mainWin.setFullScreen(true);
          }
          mainWin.focus();
          mainWin.webContents.focus();
        } catch (e) {}
      }
    };

    try {
      promptWin = new BrowserWindow({
        width,
        height,
        x,
        y,
        fullscreen: wasFullScreen,
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        alwaysOnTop: true,
        backgroundColor: '#020617',
        focusable: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: false,
          preload: path.join(__dirname, 'prompt-preload.js')
        }
      });
      activePromptWin = promptWin;

      const onResult = (_e, value) => {
        finishPrompt(value === undefined ? null : value);
      };
      ipcMain.once('mkmv-prompt-result', onResult);

      promptWin.on('closed', () => {
        ipcMain.removeListener('mkmv-prompt-result', onResult);
        finishPrompt(null);
      });

      promptWin.webContents.once('did-finish-load', () => {
        if (settled || promptWin.isDestroyed()) return;
        promptWin.webContents.send('mkmv-prompt-data', {
          message: payload.message || '',
          defaultValue: payload.defaultValue || '',
          gamepadProfile: payload.gamepadProfile || 'auto'
        });
        promptWin.show();
        promptWin.focus();
        promptWin.webContents.focus();
      });

      promptWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildPromptHtml()));
    } catch (err) {
      log.error('Failed to open prompt OSK window:', err && err.stack ? err.stack : err);
      finishPrompt(null);
    }
  });

  log.debug('Main prompt OSK IPC handler registered');
}

/**
 * 렌더러(preload) 측: window.prompt 동기 오버라이드
 */
function setupPromptRenderer({ ipcRenderer, userOpt = {} } = {}) {
  if (typeof window === 'undefined' || !ipcRenderer) return false;

  window.prompt = function mkmvPrompt(message, defaultValue) {
    if (window.Input && typeof window.Input.clear === 'function') {
      try { window.Input.clear(); } catch (e) {}
    }

    let result = null;
    try {
      result = ipcRenderer.sendSync('mkmv-prompt-sync', {
        message: message === undefined || message === null ? '' : String(message),
        defaultValue: defaultValue === undefined || defaultValue === null ? '' : String(defaultValue),
        gamepadProfile: (userOpt && userOpt.gamepadProfile) || 'auto'
      });
    } catch (err) {
      logger.error('window.prompt IPC failed:', err && err.message ? err.message : err);
      result = defaultValue === undefined || defaultValue === null ? null : String(defaultValue);
    }

    if (window.Input && typeof window.Input.clear === 'function') {
      try { window.Input.clear(); } catch (e) {}
    }
    return result === undefined ? null : result;
  };

  logger.debug('Renderer window.prompt OSK override installed');
  return true;
}

module.exports = {
  createHangulComposer,
  buildPromptHtml,
  setupPromptMain,
  setupPromptRenderer
};
