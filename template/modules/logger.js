/**
 * mkmv Unified Tiered Logging System
 *
 * 지원 로그 레벨:
 * 0: silent  - 모든 로그 비활성화
 * 1: error   - 치명적 오류, 프로세스 비정상 종료, 처리되지 않은 예외 (Release 기본)
 * 2: warn    - 경고, 에러 복구 폴백 시도
 * 3: info    - 상위 구동 이벤트 (엔진 감지, 해상도 감지, 프로필 설정 등)
 * 4: debug   - 진단 및 훅 설치, 메모리 GC 요약, Fast-forward 상태 (Debug 기본)
 * 5: verbose - 상세 추적 (매 키보드/게임패드 입력, 대소문자 탐색 세부 내역, 개별 XHR 리소스 복구)
 */

const LOG_LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  verbose: 5
};

const LEVEL_NAMES = {
  0: 'SILENT',
  1: 'ERROR',
  2: 'WARN',
  3: 'INFO',
  4: 'DEBUG',
  5: 'VERBOSE'
};

// 빌드 타임에 주입되거나 런타임에 결정되는 빌드 모드 ('release' | 'debug')
const BUILD_MODE = '__BUILD_MODE_PLACEHOLDER__';
const IS_RELEASE = BUILD_MODE === 'release';

function parseLogLevel(val, defaultLevel) {
  if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= 5) {
    return val;
  }
  if (typeof val === 'string') {
    const lower = val.toLowerCase().trim();
    if (lower in LOG_LEVELS) {
      return LOG_LEVELS[lower];
    }
  }
  return defaultLevel;
}

// 환경변수 또는 CLI 인자에서 전역 로그 레벨 탐색
function detectEnvironmentLogLevel() {
  const envLevel = typeof process !== 'undefined' && process.env && process.env.MKMV_LOG_LEVEL;
  if (envLevel) {
    return parseLogLevel(envLevel, null);
  }

  if (typeof process !== 'undefined' && Array.isArray(process.argv)) {
    if (process.argv.includes('--verbose')) {
      return LOG_LEVELS.verbose;
    }
    const arg = process.argv.find(a => a.startsWith('--log-level='));
    if (arg) {
      const val = arg.slice('--log-level='.length);
      return parseLogLevel(val, null);
    }
  }

  return null;
}

// 기본 로그 레벨: 환경변수/CLI 우선 -> 릴리즈: error(1), 디버그: debug(4)
const defaultBaseLevel = IS_RELEASE ? LOG_LEVELS.error : LOG_LEVELS.debug;
let currentLogLevel = detectEnvironmentLogLevel() ?? defaultBaseLevel;

function setLogLevel(level) {
  const parsed = parseLogLevel(level, currentLogLevel);
  currentLogLevel = parsed;
  return currentLogLevel;
}

function getLogLevel() {
  return currentLogLevel;
}

function shouldLog(level) {
  return level <= currentLogLevel;
}

function formatPrefix(tag, level) {
  const levelStr = LEVEL_NAMES[level] || 'LOG';
  return `[${tag}][${levelStr}]`;
}

function createLogger(defaultTag = 'mkmv') {
  return {
    error: (message, ...args) => {
      if (shouldLog(LOG_LEVELS.error)) {
        console.error(`${formatPrefix(defaultTag, LOG_LEVELS.error)}`, message, ...args);
      }
    },
    warn: (message, ...args) => {
      if (shouldLog(LOG_LEVELS.warn)) {
        console.warn(`${formatPrefix(defaultTag, LOG_LEVELS.warn)}`, message, ...args);
      }
    },
    info: (message, ...args) => {
      if (shouldLog(LOG_LEVELS.info)) {
        console.log(`${formatPrefix(defaultTag, LOG_LEVELS.info)}`, message, ...args);
      }
    },
    debug: (message, ...args) => {
      if (shouldLog(LOG_LEVELS.debug)) {
        console.log(`${formatPrefix(defaultTag, LOG_LEVELS.debug)}`, message, ...args);
      }
    },
    verbose: (message, ...args) => {
      if (shouldLog(LOG_LEVELS.verbose)) {
        console.log(`${formatPrefix(defaultTag, LOG_LEVELS.verbose)}`, message, ...args);
      }
    },
    setLevel: (lvl) => setLogLevel(lvl),
    getLevel: () => getLogLevel(),
    isVerbose: () => shouldLog(LOG_LEVELS.verbose),
    isDebug: () => shouldLog(LOG_LEVELS.debug)
  };
}

const defaultLogger = createLogger('mkmv');

module.exports = {
  LOG_LEVELS,
  LEVEL_NAMES,
  BUILD_MODE,
  IS_RELEASE,
  setLogLevel,
  getLogLevel,
  parseLogLevel,
  shouldLog,
  createLogger,
  logger: defaultLogger
};
