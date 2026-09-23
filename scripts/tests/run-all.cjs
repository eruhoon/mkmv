/**
 * mkmv Automated Test Runner
 *
 * scripts/tests/*.test.cjs 및 *.test.mjs 파일들을 순차 실행하고 요약합니다.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TESTS_DIR = __dirname;
const testFiles = fs.readdirSync(TESTS_DIR)
  .filter(f => (f.endsWith('.test.cjs') || f.endsWith('.test.mjs')) && f !== 'run-all.cjs')
  .sort();

console.log('========================================================');
console.log(`[test-runner] Discovered ${testFiles.length} test suites`);
console.log('========================================================');

let passed = 0;
let failed = 0;
const failures = [];

const startTime = Date.now();

for (const file of testFiles) {
  const filePath = path.join(TESTS_DIR, file);
  process.stdout.write(`\n▶ Running ${file} ...\n`);

  const res = spawnSync(process.execPath, [filePath], {
    stdio: 'inherit',
    env: process.env
  });

  if (res.status === 0) {
    passed++;
  } else {
    failed++;
    failures.push(file);
  }
}

const duration = ((Date.now() - startTime) / 1000).toFixed(2);

console.log('\n========================================================');
console.log(`[test-runner] TEST SUMMARY (${duration}s)`);
console.log(`  • Total Suites:  ${testFiles.length}`);
console.log(`  • Passed Suites: ${passed}`);
console.log(`  • Failed Suites: ${failed}`);
if (failed > 0) {
  console.log(`  • Failed Files:  ${failures.join(', ')}`);
}
console.log('========================================================');

process.exit(failed > 0 ? 1 : 0);
