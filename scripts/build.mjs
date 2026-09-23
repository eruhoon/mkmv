import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import AdmZip from 'adm-zip';
import { optimizeJavaScript } from './optimizer.mjs';

const ELECTRON_VERSION = '22.3.27';
const ELECTRON_URL = `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-linux-arm64.zip`;

const ROOT_DIR = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
const CACHE_DIR = path.join(ROOT_DIR, '.cache');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const TEMPLATE_DIR = path.join(ROOT_DIR, 'template');
const ELECTRON_ZIP_PATH = path.join(CACHE_DIR, `electron-v${ELECTRON_VERSION}-linux-arm64.zip`);

function normalizeUnixLF(content) {
  let text = content;
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

async function downloadFile(url, destPath) {
  console.log(`[mkmv] Downloading runtime from: ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to download: ${res.status} ${res.statusText}`);
  }

  const totalBytes = Number(res.headers.get('content-length') || 0);
  let downloadedBytes = 0;
  let lastPercent = 0;

  const fileStream = fs.createWriteStream(destPath);
  const reader = res.body.getReader();

  const nodeReadable = new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done) {
        this.push(null);
      } else {
        downloadedBytes += value.length;
        if (totalBytes > 0) {
          const percent = Math.floor((downloadedBytes / totalBytes) * 100);
          if (percent >= lastPercent + 10 || percent === 100) {
            console.log(`[mkmv] Download progress: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB / ${(totalBytes / 1024 / 1024).toFixed(1)}MB)`);
            lastPercent = percent;
          }
        }
        this.push(Buffer.from(value));
      }
    }
  });

  await finished(nodeReadable.pipe(fileStream));
  console.log(`[mkmv] Download complete: ${destPath}`);
}

async function ensureElectronZip() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!fs.existsSync(ELECTRON_ZIP_PATH)) {
    await downloadFile(ELECTRON_URL, ELECTRON_ZIP_PATH);
  } else {
    console.log(`[mkmv] Using cached runtime: ${ELECTRON_ZIP_PATH}`);
  }
}

/**
 * 모드별 (release 또는 debug) 패키지 빌드
 */
async function buildVariant(mode) {
  const isDebug = mode === 'debug';
  const suffix = isDebug ? '-debug' : '';
  const modeLabel = isDebug ? 'DEBUG' : 'RELEASE';

  console.log(`\n--------------------------------------------------------`);
  console.log(`[mkmv] Building ${modeLabel} packages (v${pkg.version})...`);
  console.log(`--------------------------------------------------------`);

  const variantWorkDir = path.join(DIST_DIR, `.work-${mode}`);
  const portableAppDir = path.join(variantWorkDir, 'mkmv');
  const runtimeAppDir = path.join(variantWorkDir, 'mkmv-runtime');

  fs.rmSync(variantWorkDir, { recursive: true, force: true });
  fs.mkdirSync(portableAppDir, { recursive: true });

  // 1. Electron 런타임 추출
  console.log(`[mkmv] [${mode}] Extracting Electron runtime...`);
  const zip = new AdmZip(ELECTRON_ZIP_PATH);
  zip.extractAllTo(portableAppDir, true);

  // 1-1. 릴리즈 모드 전용 런타임 다이어트 (불필요한 리소스 및 다국어 팩 슬림화)
  if (!isDebug) {
    console.log(`[mkmv] [${mode}] Pruning unused Chromium runtime resources...`);

    // (1) 미사용 언어 팩 제거 (en-US, ko, ja만 유지)
    const localesDir = path.join(portableAppDir, 'locales');
    if (fs.existsSync(localesDir)) {
      const keepLocales = new Set(['en-US.pak', 'ko.pak', 'ja.pak']);
      const localeFiles = fs.readdirSync(localesDir);
      let prunedLocalesCount = 0;
      for (const locFile of localeFiles) {
        if (!keepLocales.has(locFile)) {
          fs.rmSync(path.join(localesDir, locFile), { force: true });
          prunedLocalesCount++;
        }
      }
      console.log(`[mkmv] [${mode}] Removed ${prunedLocalesCount} unused locale packs (kept: en-US, ko, ja)`);
    }

    // (2) 불필요한 크로미움 바이너리 및 중복 문서 제거
    const unusedFiles = [
      'LICENSES.chromium.html',
      'chrome_crashpad_handler',
      'chrome-sandbox'
    ];
    for (const uFile of unusedFiles) {
      const uPath = path.join(portableAppDir, uFile);
      if (fs.existsSync(uPath)) {
        fs.rmSync(uPath, { force: true });
      }
    }
  }

  // 2. 템플릿 에셋 및 설정 복사
  const staticFiles = ['keymap.gptk', 'port.json', 'package.json', 'mkmv.json'];
  for (const file of staticFiles) {
    const src = path.join(TEMPLATE_DIR, file);
    const dest = path.join(portableAppDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }

  // 폰트, 설정, 라이브러리 디렉터리 복사
  const templateDirs = ['fonts', 'conf', 'share', 'lib'];
  for (const dirName of templateDirs) {
    const srcDir = path.join(TEMPLATE_DIR, dirName);
    const destDir = path.join(portableAppDir, dirName);
    if (fs.existsSync(srcDir)) {
      fs.cpSync(srcDir, destDir, { recursive: true });
    }
  }

  // 3. 자바스크립트 소스 최적화 및 복사 (main.js, preload.js, modules/*.js)
  console.log(`[mkmv] [${mode}] Optimizing JavaScript source files...`);
  let totalOrigJsBytes = 0;
  let totalOptJsBytes = 0;

  async function processAndCopyJs(srcPath, destPath, relName) {
    const rawContent = fs.readFileSync(srcPath, 'utf8');
    const optRes = await optimizeJavaScript(rawContent, { mode, filename: relName });
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, optRes.code, 'utf8');

    totalOrigJsBytes += optRes.originalSize;
    totalOptJsBytes += optRes.optimizedSize;
  }

  // main.js & preload.js
  await processAndCopyJs(
    path.join(TEMPLATE_DIR, 'main.js'),
    path.join(portableAppDir, 'main.js'),
    'main.js'
  );
  await processAndCopyJs(
    path.join(TEMPLATE_DIR, 'preload.js'),
    path.join(portableAppDir, 'preload.js'),
    'preload.js'
  );

  // modules/*.js
  const modulesDir = path.join(TEMPLATE_DIR, 'modules');
  if (fs.existsSync(modulesDir)) {
    const modFiles = fs.readdirSync(modulesDir).filter(f => f.endsWith('.js'));
    for (const modFile of modFiles) {
      await processAndCopyJs(
        path.join(modulesDir, modFile),
        path.join(portableAppDir, 'modules', modFile),
        `modules/${modFile}`
      );
    }
  }

  const jsSavings = totalOrigJsBytes > 0
    ? (((totalOrigJsBytes - totalOptJsBytes) / totalOrigJsBytes) * 100).toFixed(1)
    : '0.0';
  console.log(`[mkmv] [${mode}] JS size: ${(totalOrigJsBytes / 1024).toFixed(1)} KB -> ${(totalOptJsBytes / 1024).toFixed(1)} KB (${jsSavings}% reduction)`);

  // 라이선스 파일 복사
  const thirdPartyLicenseSrc = path.join(ROOT_DIR, 'THIRD_PARTY_LICENSES.md');
  if (fs.existsSync(thirdPartyLicenseSrc)) {
    fs.copyFileSync(thirdPartyLicenseSrc, path.join(portableAppDir, 'THIRD_PARTY_LICENSES.md'));
  }

  // 4. 런처 스크립트 (mkmv.sh) 준비
  const launcherSrc = path.join(TEMPLATE_DIR, 'mkmv.sh');
  const launcherDest = path.join(DIST_DIR, isDebug ? 'mkmv-debug.sh' : 'mkmv.sh');
  let launcherRaw = fs.readFileSync(launcherSrc, 'utf8');
  launcherRaw = launcherRaw.replace(/__BUILD_MODE_PLACEHOLDER__/g, mode);
  const launcherContent = normalizeUnixLF(launcherRaw);
  fs.writeFileSync(launcherDest, launcherContent, { encoding: 'utf8', flag: 'w' });

  // 5. mkmv.json 템플릿 준비
  const mkmvJsonSrc = path.join(TEMPLATE_DIR, 'mkmv.json');
  let mkmvJsonContent = fs.existsSync(mkmvJsonSrc) ? fs.readFileSync(mkmvJsonSrc, 'utf8') : '{}';

  // 6. 런타임 패키지용 template.zip 구성
  const templateZip = new AdmZip();
  templateZip.addFile('game.sh', Buffer.from(launcherContent, 'utf8'));
  templateZip.addFile('game/mkmv.json', Buffer.from(mkmvJsonContent, 'utf8'));
  const gptkSrc = path.join(TEMPLATE_DIR, 'keymap.gptk');
  if (fs.existsSync(gptkSrc)) {
    templateZip.addFile('game/keymap.gptk', fs.readFileSync(gptkSrc));
  }
  templateZip.addFile('game/game/.gitkeep', Buffer.from(''));
  const templateZipBuffer = templateZip.toBuffer();

  // 7. mkmv-runtime 디렉터리 준비
  fs.cpSync(portableAppDir, runtimeAppDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeAppDir, 'template.zip'), templateZipBuffer);

  // 8. 포터블 game/save 디렉터리 구성
  const gameDir = path.join(portableAppDir, 'game');
  const saveDir = path.join(gameDir, 'save');
  fs.mkdirSync(saveDir, { recursive: true });
  fs.writeFileSync(path.join(gameDir, '.gitkeep'), '');
  fs.writeFileSync(path.join(saveDir, '.gitkeep'), '');

  // 9. Zip 압축 산출물 생성
  const runtimeZipName = `mkmv-runtime${suffix}-v${pkg.version}.zip`;
  const portableZipName = `mkmv-portable${suffix}-v${pkg.version}.zip`;
  const runtimeZipPath = path.join(DIST_DIR, runtimeZipName);
  const portableZipPath = path.join(DIST_DIR, portableZipName);

  const howToUseSrc = path.join(ROOT_DIR, 'HOW_TO_USE.md');
  const rootLicenseSrc = path.join(ROOT_DIR, 'LICENSE');

  // 9-1. Runtime Zip
  console.log(`[mkmv] [${mode}] Writing runtime zip: ${runtimeZipName}...`);
  const runtimeZip = new AdmZip();
  if (fs.existsSync(howToUseSrc)) runtimeZip.addLocalFile(howToUseSrc);
  if (fs.existsSync(rootLicenseSrc)) runtimeZip.addLocalFile(rootLicenseSrc);
  if (fs.existsSync(thirdPartyLicenseSrc)) runtimeZip.addLocalFile(thirdPartyLicenseSrc);
  runtimeZip.addLocalFolder(runtimeAppDir, `mkmv-runtime${suffix}`);
  runtimeZip.writeZip(runtimeZipPath);

  // 9-2. Portable Zip
  console.log(`[mkmv] [${mode}] Writing portable zip: ${portableZipName}...`);
  const portableZip = new AdmZip();
  portableZip.addLocalFile(launcherDest);
  if (fs.existsSync(howToUseSrc)) portableZip.addLocalFile(howToUseSrc);
  if (fs.existsSync(rootLicenseSrc)) portableZip.addLocalFile(rootLicenseSrc);
  if (fs.existsSync(thirdPartyLicenseSrc)) portableZip.addLocalFile(thirdPartyLicenseSrc);
  portableZip.addLocalFolder(portableAppDir, `mkmv${suffix}`);
  portableZip.writeZip(portableZipPath);

  // 9-3. 릴리즈인 경우 레거시 호환 에일리어스 복사
  if (!isDebug) {
    const legacyZipPath = path.join(DIST_DIR, `mkmv-v${pkg.version}.zip`);
    fs.copyFileSync(portableZipPath, legacyZipPath);
  }

  // 임시 워크 디렉터리 정리
  fs.rmSync(variantWorkDir, { recursive: true, force: true });

  const runtimeStat = fs.statSync(runtimeZipPath);
  const portableStat = fs.statSync(portableZipPath);

  return {
    mode,
    modeLabel,
    totalOrigJsBytes,
    totalOptJsBytes,
    runtimeZipName,
    runtimeZipPath,
    runtimeZipSize: runtimeStat.size,
    portableZipName,
    portableZipPath,
    portableZipSize: portableStat.size
  };
}

async function build() {
  const targetArg = process.argv.find(a => a.startsWith('--target='));
  const target = targetArg ? targetArg.slice('--target='.length).toLowerCase() : 'all';

  console.log('========================================================');
  console.log(`[mkmv] Starting build for version ${pkg.version} (Target: ${target.toUpperCase()})`);
  console.log(`[mkmv] Electron Version: ${ELECTRON_VERSION}`);
  console.log('========================================================');

  // 1. Electron 런타임 캐시 확인
  await ensureElectronZip();

  // 2. dist 폴더 정리 (target에 따라 선택적 또는 전체 초기화)
  if (target === 'all') {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const results = [];

  if (target === 'all' || target === 'release') {
    const relRes = await buildVariant('release');
    results.push(relRes);
  }

  if (target === 'all' || target === 'debug') {
    const dbgRes = await buildVariant('debug');
    results.push(dbgRes);
  }

  // 빌드 결과 요약 리포트
  console.log('\n========================================================');
  console.log(`[mkmv] BUILD SUMMARY (v${pkg.version})`);
  console.log('========================================================');
  for (const r of results) {
    const jsRed = r.totalOrigJsBytes > 0
      ? (((r.totalOrigJsBytes - r.totalOptJsBytes) / r.totalOrigJsBytes) * 100).toFixed(1)
      : '0.0';
    console.log(`[${r.modeLabel}]`);
    console.log(`  • JS Bundle Size:     ${(r.totalOptJsBytes / 1024).toFixed(1)} KB (orig: ${(r.totalOrigJsBytes / 1024).toFixed(1)} KB, -${jsRed}%)`);
    console.log(`  • Runtime Package:    dist/${r.runtimeZipName} (${(r.runtimeZipSize / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`  • Portable Package:   dist/${r.portableZipName} (${(r.portableZipSize / 1024 / 1024).toFixed(2)} MB)`);
  }
  console.log('========================================================');
}

build().catch(err => {
  console.error('[mkmv] Build failed:', err);
  process.exit(1);
});
