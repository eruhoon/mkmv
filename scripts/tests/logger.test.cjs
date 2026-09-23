const assert = require('assert');
const test = require('node:test');
const {
  LOG_LEVELS,
  LEVEL_NAMES,
  setLogLevel,
  getLogLevel,
  parseLogLevel,
  shouldLog,
  createLogger
} = require('../../template/modules/logger.js');

test('logger: parseLogLevel recognizes string and numeric levels', () => {
  assert.strictEqual(parseLogLevel('silent', 1), LOG_LEVELS.silent);
  assert.strictEqual(parseLogLevel('error', 0), LOG_LEVELS.error);
  assert.strictEqual(parseLogLevel('warn', 0), LOG_LEVELS.warn);
  assert.strictEqual(parseLogLevel('info', 0), LOG_LEVELS.info);
  assert.strictEqual(parseLogLevel('debug', 0), LOG_LEVELS.debug);
  assert.strictEqual(parseLogLevel('verbose', 0), LOG_LEVELS.verbose);

  // 대소문자 무관
  assert.strictEqual(parseLogLevel('DEBUG', 0), LOG_LEVELS.debug);
  assert.strictEqual(parseLogLevel('  Verbose  ', 0), LOG_LEVELS.verbose);

  // 숫자
  assert.strictEqual(parseLogLevel(1, 0), 1);
  assert.strictEqual(parseLogLevel(5, 0), 5);

  // 알 수 없는 값은 기본값 폴백
  assert.strictEqual(parseLogLevel('invalid', 3), 3);
  assert.strictEqual(parseLogLevel(null, 4), 4);
});

test('logger: setLogLevel and shouldLog follow level hierarchy', () => {
  // 1. error 레벨일 때: error만 허용되고 warn/info/debug/verbose 차단
  setLogLevel('error');
  assert.strictEqual(getLogLevel(), LOG_LEVELS.error);
  assert.strictEqual(shouldLog(LOG_LEVELS.error), true);
  assert.strictEqual(shouldLog(LOG_LEVELS.warn), false);
  assert.strictEqual(shouldLog(LOG_LEVELS.info), false);
  assert.strictEqual(shouldLog(LOG_LEVELS.debug), false);
  assert.strictEqual(shouldLog(LOG_LEVELS.verbose), false);

  // 2. debug 레벨일 때: error, warn, info, debug 허용, verbose만 차단
  setLogLevel('debug');
  assert.strictEqual(getLogLevel(), LOG_LEVELS.debug);
  assert.strictEqual(shouldLog(LOG_LEVELS.error), true);
  assert.strictEqual(shouldLog(LOG_LEVELS.warn), true);
  assert.strictEqual(shouldLog(LOG_LEVELS.info), true);
  assert.strictEqual(shouldLog(LOG_LEVELS.debug), true);
  assert.strictEqual(shouldLog(LOG_LEVELS.verbose), false);

  // 3. verbose 레벨일 때: 모든 레벨 허용
  setLogLevel('verbose');
  assert.strictEqual(getLogLevel(), LOG_LEVELS.verbose);
  assert.strictEqual(shouldLog(LOG_LEVELS.verbose), true);

  // 4. silent 레벨일 때: 모든 레벨 차단
  setLogLevel('silent');
  assert.strictEqual(getLogLevel(), LOG_LEVELS.silent);
  assert.strictEqual(shouldLog(LOG_LEVELS.error), false);
});

test('logger: logger outputs capture and formatting', () => {
  const custom = createLogger('test-comp');
  let capturedLog = null;
  let capturedErr = null;
  let capturedWarn = null;

  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;

  console.log = (...args) => { capturedLog = args.join(' '); };
  console.error = (...args) => { capturedErr = args.join(' '); };
  console.warn = (...args) => { capturedWarn = args.join(' '); };

  try {
    setLogLevel('error');
    custom.debug('this should not be logged');
    assert.strictEqual(capturedLog, null, 'debug log must be suppressed in error level');

    custom.error('critical failure!');
    assert.ok(capturedErr && capturedErr.includes('[test-comp][ERROR] critical failure!'), 'error log must be formatted');

    setLogLevel('verbose');
    custom.verbose('trace event 123');
    assert.ok(capturedLog && capturedLog.includes('[test-comp][VERBOSE] trace event 123'), 'verbose log must be printed');
  } finally {
    console.log = origLog;
    console.error = origErr;
    console.warn = origWarn;
  }
});
