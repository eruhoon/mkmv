/**
 * mkmv JavaScript Optimizer & Minifier
 *
 * 기능:
 * 1. 빌드 모드 치환 (__BUILD_MODE_PLACEHOLDER__ -> 'release' | 'debug')
 * 2. Terser AST 기반 완벽 난독화 & 압축 (Terser 설치 시)
 * 3. 무의존성 내장 경량 Minifier Fallback (오프라인/외부 의존성 부재 시 안전 보장):
 *    - 문자열/템플릿 리터럴 및 정규식 안전 보존
 *    - 단일행/여러행 주석 100% 제거
 *    - 공백 및 줄바꿈 압축
 */

let terser = null;
try {
  terser = await import('terser');
} catch (e) {
  // Terser not available; fallback to built-in minifier
}

const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'delete', 'void', 'throw', 'case', 'yield', 'await', 'instanceof'
]);

function isRegexStart(raw) {
  const trimmed = raw.trimEnd();
  if (!trimmed) return true;
  const lastChar = trimmed[trimmed.length - 1];
  if ('([{:;,?!~=+-*%&|^<>'.includes(lastChar)) return true;
  const match = trimmed.match(/[a-zA-Z_$][a-zA-Z0-9_$]*$/);
  if (match && REGEX_KEYWORDS.has(match[0])) return true;
  return false;
}

/**
 * 문자열, 정규식, 템플릿 리터럴을 파싱하여 주석과 불필요한 공백을 안전하게 제거하는 경량 파서
 */
export function builtinMinify(code) {
  const literals = [];
  let result = '';
  const len = code.length;
  let i = 0;

  while (i < len) {
    const ch = code[i];
    const next = code[i + 1];

    // 1. 단일행 주석 제거 (// ...)
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && code[i] !== '\n' && code[i] !== '\r') {
        i++;
      }
      continue;
    }

    // 2. 여러행 주석 제거 (/* ... */)
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) {
        i++;
      }
      i += 2; // skip */
      continue;
    }

    // 3. 정규식 리터럴 보호 (/.../flags)
    if (ch === '/' && isRegexStart(result)) {
      let regex = '/';
      let inClass = false;
      i++;
      while (i < len) {
        const c = code[i];
        regex += c;
        if (c === '\\') {
          i++;
          if (i < len) regex += code[i];
        } else if (c === '[') {
          inClass = true;
        } else if (c === ']' && inClass) {
          inClass = false;
        } else if (c === '/' && !inClass) {
          i++;
          while (i < len && /[a-z]/i.test(code[i])) {
            regex += code[i];
            i++;
          }
          break;
        }
        i++;
      }
      const token = `__MKMV_STR_${literals.length}__`;
      literals.push(regex);
      result += token;
      continue;
    }

    // 3. 문자열 리터럴 보호 ('...' 또는 "...")
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let str = quote;
      i++;
      while (i < len) {
        const c = code[i];
        str += c;
        if (c === '\\') {
          i++;
          if (i < len) str += code[i];
        } else if (c === quote) {
          i++;
          break;
        }
        i++;
      }
      const token = `__MKMV_STR_${literals.length}__`;
      literals.push(str);
      result += token;
      continue;
    }

    // 4. 템플릿 리터럴 보호 (`...`)
    if (ch === '`') {
      let tpl = '`';
      i++;
      while (i < len) {
        const c = code[i];
        tpl += c;
        if (c === '\\') {
          i++;
          if (i < len) tpl += code[i];
        } else if (c === '`') {
          i++;
          break;
        }
        i++;
      }
      const token = `__MKMV_STR_${literals.length}__`;
      literals.push(tpl);
      result += token;
      continue;
    }

    // 5. 일반 코드 문자
    result += ch;
    i++;
  }

  // 코드 부분 공백 및 줄바꿈 압축
  let compressed = result
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([{}();,:><!=+\-*/%&|^?~])\s*/g, '$1')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 문자열/템플릿 리터럴 원형 복원
  for (let idx = 0; idx < literals.length; idx++) {
    compressed = compressed.replace(`__MKMV_STR_${idx}__`, () => literals[idx]);
  }

  return compressed;
}

/**
 * JS 코드 최적화 및 난독화 진입점
 */
export async function optimizeJavaScript(sourceCode, options = {}) {
  const { mode = 'release', filename = 'unknown.js' } = options;

  // 1. 빌드 모드 치환
  let processed = sourceCode.replace(/__BUILD_MODE_PLACEHOLDER__/g, mode);

  if (mode === 'debug') {
    // 디버그 모드는 소스 원형과 가독성을 온전히 보존
    return {
      code: processed,
      engine: 'raw-debug',
      originalSize: Buffer.byteLength(sourceCode, 'utf8'),
      optimizedSize: Buffer.byteLength(processed, 'utf8')
    };
  }

  const origSize = Buffer.byteLength(sourceCode, 'utf8');

  // 2. 릴리즈 모드: Terser 사용 가능 시 AST 압축 & 난독화
  if (terser && (terser.minify || (terser.default && terser.default.minify))) {
    try {
      const minifyFn = terser.minify || terser.default.minify;
      const res = await minifyFn(processed, {
        compress: {
          drop_debugger: true,
          dead_code: true,
          passes: 2
        },
        mangle: {
          toplevel: false,
          keep_fnames: true // 함수 이름 보존 (알만툴 엔진 및 스택 트레이스 호환)
        },
        format: {
          comments: false
        }
      });
      if (res && res.code) {
        return {
          code: res.code,
          engine: 'terser',
          originalSize: origSize,
          optimizedSize: Buffer.byteLength(res.code, 'utf8')
        };
      }
    } catch (e) {
      console.warn(`[optimizer] Terser failed for ${filename}, falling back to builtin:`, e.message);
    }
  }

  // 3. 무의존성 내장 Minifier 처리
  const minified = builtinMinify(processed);
  return {
    code: minified,
    engine: 'builtin-minifier',
    originalSize: origSize,
    optimizedSize: Buffer.byteLength(minified, 'utf8')
  };
}
