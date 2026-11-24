const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  getMimeType,
  parseRangeHeader,
  decodeFileRequestPath,
  createFileStreamHandler
} = require('../../template/modules/file-protocol.js');
const { resolveCaseInsensitive, invalidatePathCaches } = require('../../template/modules/fs-virtual.js');

function readStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

test('getMimeType maps webm and standard RPG Maker asset extensions', () => {
  assert.equal(getMimeType('movies/NTR配信　エンディング.webm'), 'video/webm');
  assert.equal(getMimeType('index.html'), 'text/html; charset=utf-8');
  assert.equal(getMimeType('js/main.js'), 'application/javascript; charset=utf-8');
  assert.equal(getMimeType('data/System.json'), 'application/json; charset=utf-8');
  assert.equal(getMimeType('unknown.bin'), 'application/octet-stream');
});

test('parseRangeHeader handles open, closed, suffix, and invalid ranges', () => {
  assert.deepEqual(parseRangeHeader('bytes=0-', 100), { start: 0, end: 99 });
  assert.deepEqual(parseRangeHeader('bytes=10-29', 100), { start: 10, end: 29 });
  assert.deepEqual(parseRangeHeader('bytes=50-999', 100), { start: 50, end: 99 });
  assert.deepEqual(parseRangeHeader('bytes=-20', 100), { start: 80, end: 99 });
  assert.deepEqual(parseRangeHeader('bytes=100-110', 100), { invalid: true });
  assert.deepEqual(parseRangeHeader('bytes=30-20', 100), { invalid: true });
  assert.equal(parseRangeHeader(null, 100), null);
});

test('decodeFileRequestPath decodes Unicode URLs and handles win32 drive slash', () => {
  assert.equal(
    decodeFileRequestPath('file:///roms/game/movies/NTR%E9%85%8D%E4%BF%A1%E3%80%80%E3%82%A8%E3%83%B3%E3%83%87%E3%82%A3%E3%83%B3%E3%82%B0.webm', 'linux'),
    '/roms/game/movies/NTR配信　エンディング.webm'
  );
  assert.equal(
    decodeFileRequestPath('file:///D:/game/movies/PV1.webm', 'win32'),
    'D:/game/movies/PV1.webm'
  );
});

test('createFileStreamHandler serves Unicode webm with 200, 206 Range, 416, and 404', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkmv-fp-'));
  try {
    const moviesDir = path.join(tmpDir, 'movies');
    fs.mkdirSync(moviesDir, { recursive: true });
    const moviePath = path.join(moviesDir, 'NTR配信　エンディング.webm');
    const payload = Buffer.from('0123456789ABCDEF');
    fs.writeFileSync(moviePath, payload);
    invalidatePathCaches();

    const handler = createFileStreamHandler({
      gameDir: tmpDir,
      resolveCaseInsensitive
    });

    const invoke = (url, headers = {}) => new Promise((resolve) => {
      handler({ url, headers }, resolve);
    });

    const url = pathToFileURL(moviePath).toString();

    const res200 = await invoke(url);
    assert.equal(res200.statusCode, 200);
    assert.equal(res200.headers['Content-Type'], 'video/webm');
    assert.equal(res200.headers['Accept-Ranges'], 'bytes');
    assert.equal(res200.headers['Content-Length'], String(payload.length));
    assert.deepEqual(await readStream(res200.data), payload);

    const res206 = await invoke(url, { Range: 'bytes=4-9' });
    assert.equal(res206.statusCode, 206);
    assert.equal(res206.headers['Content-Range'], 'bytes 4-9/16');
    assert.equal(res206.headers['Content-Length'], '6');
    assert.deepEqual(await readStream(res206.data), Buffer.from('456789'));

    const res416 = await invoke(url, { Range: 'bytes=99-100' });
    assert.equal(res416.statusCode, 416);
    assert.equal(res416.headers['Content-Range'], 'bytes */16');

    const res404 = await invoke(pathToFileURL(path.join(moviesDir, 'missing.webm')).toString());
    assert.equal(res404.statusCode, 404);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
