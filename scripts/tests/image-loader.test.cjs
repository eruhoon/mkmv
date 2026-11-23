const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { setupImageLoader } = require('../../template/modules/image-loader.js');

test('setupImageLoader skips resolveGamePath for ASCII URLs and revokes Blob URLs on Unicode load', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-img-test-'));
  const unicodeFile = path.join(tmpDir, '한글_이미지.png');
  fs.writeFileSync(unicodeFile, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0]));

  const origWindow = global.window;
  const origDocument = global.document;
  const origBlob = global.Blob;
  const origURL = global.URL;
  const origHTMLImage = global.HTMLImageElement;

  const requestedUrls = [];
  const resolveCalls = [];
  const revokedUrls = [];

  try {
    function MockImage() {
      this._listeners = {};
      this.src = '';
    }
    MockImage.prototype.addEventListener = function(type, fn) {
      this._listeners[type] = this._listeners[type] || [];
      this._listeners[type].push(fn);
    };
    MockImage.prototype.removeEventListener = function(type, fn) {
      if (!this._listeners[type]) return;
      this._listeners[type] = this._listeners[type].filter(f => f !== fn);
    };
    MockImage.prototype.emit = function(type) {
      for (const fn of (this._listeners[type] || []).slice()) fn({ target: this });
    };

    function MockBitmap() {}
    MockBitmap.prototype._requestImage = function(url) {
      requestedUrls.push(url);
      this._image = new MockImage();
      this._image.src = url;
    };

    global.window = {
      Bitmap: MockBitmap,
      addEventListener() {}
    };
    global.document = {
      getElementById: () => null,
      createElement: () => ({}),
      head: { appendChild() {} },
      addEventListener() {}
    };
    global.HTMLImageElement = undefined;
    global.Blob = function(parts, opts) {
      this.parts = parts;
      this.type = opts && opts.type;
    };
    global.URL = {
      createObjectURL: () => 'blob:mkmv-test/1',
      revokeObjectURL: (u) => { revokedUrls.push(u); }
    };

    setupImageLoader({
      gameDir: tmpDir,
      origExistsSync: fs.existsSync,
      origReadFileSync: fs.readFileSync,
      resolveGamePath: (u) => {
        resolveCalls.push(u);
        return path.join(tmpDir, u);
      }
    });

    // 1. Plain ASCII URL must bypass resolveGamePath completely
    const asciiBmp = new MockBitmap();
    asciiBmp._requestImage('img/pictures/Actor1.png');
    assert.equal(resolveCalls.length, 0);
    assert.equal(requestedUrls[0], 'img/pictures/Actor1.png');

    // 2. Unicode URL loads via fs into Blob URL and revokes on load
    const unicodeBmp = new MockBitmap();
    unicodeBmp._requestImage('한글_이미지.png');
    assert.equal(resolveCalls.length, 1);
    assert.equal(requestedUrls[1], 'blob:mkmv-test/1');
    unicodeBmp._image.emit('load');
    assert.deepEqual(revokedUrls, ['blob:mkmv-test/1']);
  } finally {
    global.window = origWindow;
    global.document = origDocument;
    global.Blob = origBlob;
    global.URL = origURL;
    global.HTMLImageElement = origHTMLImage;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
