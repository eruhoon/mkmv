import assert from 'node:assert';
import test from 'node:test';
import { builtinMinify, optimizeJavaScript } from '../optimizer.mjs';

test('optimizer: builtinMinify strips comments while preserving string and template literals', () => {
  const sample = `
    // This is a line comment
    const greeting = "Hello // not a comment";
    /*
      Multi-line comment
    */
    const template = \`line 1
    // not comment in template
    line 2\`;
    function test() {
      return 123;
    }
  `;

  const minified = builtinMinify(sample);
  assert.ok(!minified.includes('This is a line comment'), 'line comment should be removed');
  assert.ok(!minified.includes('Multi-line comment'), 'multiline comment should be removed');
  assert.ok(minified.includes('Hello // not a comment'), 'string literal comment characters preserved');
  assert.ok(minified.includes('// not comment in template'), 'template literal contents preserved');
  assert.ok(minified.includes('function test(){return 123;}') || minified.includes('function test() {return 123;}'), 'code should be minified');
});

test('optimizer: builtinMinify preserves regular expressions with escaped slashes and character classes', () => {
  const sample = `
    const r1 = /^file:\\/\\//;
    const r2 = /^[\\/\\\\]?www[\\/\\\\]/i;
    const r3 = s => s.replace(/\\uFEFF/g, '');
    const div = 10 / 2;
    return r1.test('file://foo') && div === 5;
  `;
  const minified = builtinMinify(sample);
  assert.doesNotThrow(() => {
    new Function(minified);
  }, 'minified code with regex should have valid syntax');
  assert.ok(minified.includes('/^file:\\/\\//'), 'regex with escaped slashes preserved');
  assert.ok(minified.includes('/^[\\/\\\\]?www[\\/\\\\]/i'), 'regex with character class preserved');
});

test('optimizer: optimizeJavaScript replaces placeholder with release and debug modes', async () => {
  const code = `
    const BUILD_MODE = '__BUILD_MODE_PLACEHOLDER__';
    // Debug helper
    function getMode() {
      return BUILD_MODE;
    }
  `;

  // Release mode
  const relRes = await optimizeJavaScript(code, { mode: 'release', filename: 'test.js' });
  assert.ok(relRes.code.includes("'release'") || relRes.code.includes('"release"'), 'should contain release mode');
  assert.ok(!relRes.code.includes('__BUILD_MODE_PLACEHOLDER__'), 'placeholder replaced');
  assert.ok(!relRes.code.includes('Debug helper'), 'comment stripped in release');
  assert.ok(relRes.optimizedSize < relRes.originalSize, 'optimized size should be smaller');

  // Debug mode
  const dbgRes = await optimizeJavaScript(code, { mode: 'debug', filename: 'test.js' });
  assert.ok(dbgRes.code.includes("'debug'") || dbgRes.code.includes('"debug"'), 'should contain debug mode');
  assert.ok(dbgRes.code.includes('Debug helper'), 'comment preserved in debug');
});
