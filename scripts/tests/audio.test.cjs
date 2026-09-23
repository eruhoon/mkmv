const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  patchAudioFocus,
  setupAudioRecovery,
  setupUniversalAudioRecovery
} = require('../../template/modules/audio.js');

test('patchAudioFocus disables visibility change callbacks', () => {
  global.window = {
    WebAudio: {
      _onVisibilityChange: () => 'original'
    },
    AudioManager: {
      _onVisibilityChange: () => 'original'
    }
  };

  patchAudioFocus();
  assert.equal(window.WebAudio._onVisibilityChange(), undefined);
  assert.equal(window.AudioManager._onVisibilityChange(), undefined);
});

test('setupAudioRecovery resumes suspended audio context on focus', () => {
  let resumed = false;
  const listeners = {};
  global.window = {
    WebAudio: {
      _context: {
        state: 'suspended',
        resume: async () => { resumed = true; }
      }
    },
    addEventListener: (event, handler) => {
      listeners[event] = handler;
    }
  };
  global.document = {
    addEventListener: () => {}
  };

  setupAudioRecovery();
  assert.equal(typeof listeners['focus'], 'function');
  listeners['focus']();

  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(resumed, true);
      resolve();
    }, 20);
  });
});

test('setupUniversalAudioRecovery hooks WebAudio and Html5Audio prototypes', () => {
  global.window = {
    WebAudio: {
      prototype: {
        _load: function(url) { return 'original-webaudio'; }
      }
    },
    Html5Audio: {
      _load: function(url) { return 'original-html5'; }
    }
  };

  setupUniversalAudioRecovery({
    resolveGamePath: (p) => p,
    origExistsSync: () => true,
    origReadFileSync: () => Buffer.from('audio-data')
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(window.WebAudio.prototype._mkmvAudioHooked, true);
      assert.equal(window.Html5Audio._mkmvAudioHooked, true);
      resolve();
    }, 60);
  });
});
