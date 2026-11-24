const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.ogv': 'video/ogg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm'
};

function getMimeType(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function parseRangeHeader(rangeHeader, fileSize) {
  if (!rangeHeader || typeof rangeHeader !== 'string') {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') {
    return null;
  }
  if (fileSize <= 0) {
    return { invalid: true };
  }

  let start;
  let end;
  if (rawStart === '') {
    const suffixLength = parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { invalid: true };
    }
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = parseInt(rawStart, 10);
    end = rawEnd === '' ? fileSize - 1 : Math.min(parseInt(rawEnd, 10), fileSize - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= fileSize || start > end) {
    return { invalid: true };
  }
  return { start, end };
}

function decodeFileRequestPath(requestUrl, platform = process.platform) {
  const rawPath = new URL(requestUrl).pathname;
  let pathname = decodeURIComponent(rawPath).replace(/\uFEFF/g, '');
  if (platform === 'win32' && pathname.startsWith('/') && pathname.length > 2 && pathname[2] === ':') {
    pathname = pathname.slice(1);
  }
  return pathname;
}

function createEmptyStream() {
  return Readable.from([]);
}

/**
 * Creates a stream protocol handler for `file://` requests that resolves
 * case-insensitive paths and serves Unicode/non-ASCII media with HTTP Range
 * support (avoiding Electron 22 interceptFileProtocol media format errors).
 */
function createFileStreamHandler({ gameDir, resolveCaseInsensitive, logger, fsModule = fs }) {
  return function handleFileStreamRequest(request, callback) {
    try {
      const pathname = decodeFileRequestPath(request.url);
      const resolved = resolveCaseInsensitive(pathname, gameDir);
      if (logger && typeof logger.verbose === 'function') {
        logger.verbose(`interceptFile: "${pathname}" -> "${resolved}"`);
      }

      const stat = fsModule.statSync(resolved);
      if (!stat.isFile()) {
        callback({ statusCode: 404, data: createEmptyStream() });
        return;
      }

      const mime = getMimeType(resolved);
      const headers = request.headers || {};
      const rangeHeader = headers.Range || headers.range;
      const range = parseRangeHeader(rangeHeader, stat.size);

      if (range && range.invalid) {
        callback({
          statusCode: 416,
          headers: {
            'Content-Range': `bytes */${stat.size}`
          },
          data: createEmptyStream()
        });
        return;
      }

      if (range) {
        callback({
          statusCode: 206,
          headers: {
            'Content-Type': mime,
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
            'Content-Length': String(range.end - range.start + 1)
          },
          data: fsModule.createReadStream(resolved, { start: range.start, end: range.end })
        });
        return;
      }

      callback({
        statusCode: 200,
        headers: {
          'Content-Type': mime,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(stat.size)
        },
        data: stat.size === 0 ? createEmptyStream() : fsModule.createReadStream(resolved)
      });
    } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
        callback({ statusCode: 404, data: createEmptyStream() });
        return;
      }
      if (logger && typeof logger.error === 'function') {
        logger.error(`[mkmv-protocol-error] URL: ${request.url}`, e);
      }
      callback({ statusCode: 404, data: createEmptyStream() });
    }
  };
}

module.exports = {
  MIME_TYPES,
  getMimeType,
  parseRangeHeader,
  decodeFileRequestPath,
  createFileStreamHandler
};
