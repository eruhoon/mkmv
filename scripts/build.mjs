import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import AdmZip from 'adm-zip';

const ELECTRON_VERSION = '22.3.27';
const ELECTRON_URL = `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-linux-arm64.zip`;

const ROOT_DIR = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
const CACHE_DIR = path.join(ROOT_DIR, '.cache');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const TEMPLATE_DIR = path.join(ROOT_DIR, 'template');
const ELECTRON_ZIP_PATH = path.join(CACHE_DIR, `electron-v${ELECTRON_VERSION}-linux-arm64.zip`);

// 패키지 경로 정의
const DIST_PORTABLE_APP_DIR = path.join(DIST_DIR, 'mkmv');
const DIST_RUNTIME_APP_DIR = path.join(DIST_DIR, 'mkmv-runtime');

const RUNTIME_ZIP_NAME = `mkmv-runtime-v${pkg.version}.zip`;
const PORTABLE_ZIP_NAME = `mkmv-portable-v${pkg.version}.zip`;
const LEGACY_ZIP_NAME = `mkmv-v${pkg.version}.zip`;

const DIST_RUNTIME_ZIP_PATH = path.join(DIST_DIR, RUNTIME_ZIP_NAME);
const DIST_PORTABLE_ZIP_PATH = path.join(DIST_DIR, PORTABLE_ZIP_NAME);
const DIST_LEGACY_ZIP_PATH = path.join(DIST_DIR, LEGACY_ZIP_NAME);

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

function normalizeUnixLF(content) {
  let text = content;
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

async function build() {
  console.log('========================================================');
  console.log(`[mkmv] Starting dual build (Runtime & Portable) - Electron v${ELECTRON_VERSION}`);
  console.log('========================================================');

  // 1. Ensure directories exist
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_PORTABLE_APP_DIR, { recursive: true });

  // 2. Download runtime if not cached
  if (!fs.existsSync(ELECTRON_ZIP_PATH)) {
    await downloadFile(ELECTRON_URL, ELECTRON_ZIP_PATH);
  } else {
    console.log(`[mkmv] Using cached runtime: ${ELECTRON_ZIP_PATH}`);
  }

  // 3. Extract Electron runtime
  console.log('[mkmv] Extracting Electron runtime...');
  const zip = new AdmZip(ELECTRON_ZIP_PATH);
  zip.extractAllTo(DIST_PORTABLE_APP_DIR, true);

  // 4. WebGL 및 SwiftShader 가속 라이브러리는 RPG Maker MZ 구동을 위해 보존
  console.log('[mkmv] Preserved WebGL/SwiftShader driver libraries for MZ compatibility.');

  // 5. Copy template files to portable app dir
  console.log('[mkmv] Copying template source files...');
  const templateFiles = [
    'main.js',
    'preload.js',
    'keymap.gptk',
    'port.json',
    'package.json',
    'mkmv.json'
  ];

  for (const file of templateFiles) {
    const src = path.join(TEMPLATE_DIR, file);
    const dest = path.join(DIST_PORTABLE_APP_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }

  // Copy template directories if exist (fonts, conf, share, lib, modules)
  const templateDirs = ['fonts', 'conf', 'share', 'lib', 'modules'];
  for (const dirName of templateDirs) {
    const srcDir = path.join(TEMPLATE_DIR, dirName);
    const destDir = path.join(DIST_PORTABLE_APP_DIR, dirName);
    if (fs.existsSync(srcDir)) {
      fs.cpSync(srcDir, destDir, { recursive: true });
      console.log(`[mkmv] Copied template/${dirName} to dist/mkmv/${dirName}.`);
    }
  }

  // Copy license files to dist app directory
  const thirdPartyLicenseSrc = path.join(ROOT_DIR, 'THIRD_PARTY_LICENSES.md');
  if (fs.existsSync(thirdPartyLicenseSrc)) {
    fs.copyFileSync(thirdPartyLicenseSrc, path.join(DIST_PORTABLE_APP_DIR, 'THIRD_PARTY_LICENSES.md'));
  }

  // Prepare launcher with strict Unix LF line endings and no BOM
  const launcherSrc = path.join(TEMPLATE_DIR, 'mkmv.sh');
  const launcherDest = path.join(DIST_DIR, 'mkmv.sh');
  const launcherRaw = fs.readFileSync(launcherSrc, 'utf8');
  const launcherContent = normalizeUnixLF(launcherRaw);
  fs.writeFileSync(launcherDest, launcherContent, { encoding: 'utf8', flag: 'w' });

  // Prepare mkmv.json template content
  const mkmvJsonSrc = path.join(TEMPLATE_DIR, 'mkmv.json');
  const mkmvJsonContent = fs.existsSync(mkmvJsonSrc) 
    ? fs.readFileSync(mkmvJsonSrc, 'utf8') 
    : JSON.stringify({
        width: 1920,
        height: 1080,
        fullscreen: true,
        autoDetectResolution: true,
        forceDeviceScaleFactor: 1.0,
        scaling: 'fit',
        pixelated: true,
        hideCursor: false,
        disableTouch: false,
        showFps: false,
        debugKeymap: false,
        disableNativeGamepad: true,
        fastForward: true,
        fastForwardSpeed: 2,
        performanceProfile: 'auto'
      }, null, 2);

  // 6. Build template.zip for Runtime Package (평소 파일/더미 런처 노출 방지)
  console.log('[mkmv] Creating template.zip for Runtime Package...');
  const templateZip = new AdmZip();
  templateZip.addFile('game.sh', Buffer.from(launcherContent, 'utf8'));
  templateZip.addFile('game/mkmv.json', Buffer.from(mkmvJsonContent, 'utf8'));
  const gptkSrc = path.join(TEMPLATE_DIR, 'keymap.gptk');
  if (fs.existsSync(gptkSrc)) {
    templateZip.addFile('game/keymap.gptk', fs.readFileSync(gptkSrc));
  }
  templateZip.addFile('game/game/.gitkeep', Buffer.from(''));
  const templateZipBuffer = templateZip.toBuffer();

  // 7. Prepare Runtime App Directory (mkmv-runtime)
  console.log('[mkmv] Preparing dist/mkmv-runtime directory...');
  fs.cpSync(DIST_PORTABLE_APP_DIR, DIST_RUNTIME_APP_DIR, { recursive: true });
  fs.writeFileSync(path.join(DIST_RUNTIME_APP_DIR, 'template.zip'), templateZipBuffer);

  // 8. Prepare Portable App Directory (mkmv with game/save)
  const gameDir = path.join(DIST_PORTABLE_APP_DIR, 'game');
  const saveDir = path.join(gameDir, 'save');
  fs.mkdirSync(saveDir, { recursive: true });
  fs.writeFileSync(path.join(gameDir, '.gitkeep'), '');
  fs.writeFileSync(path.join(saveDir, '.gitkeep'), '');

  // 9. Create Artifact 1: Runtime Package (mkmv-runtime-v*.zip)
  console.log(`[mkmv] Creating Runtime Package zip: dist/${RUNTIME_ZIP_NAME}...`);
  const runtimeZip = new AdmZip();
  const howToUseSrc = path.join(ROOT_DIR, 'HOW_TO_USE.md');
  if (fs.existsSync(howToUseSrc)) {
    runtimeZip.addLocalFile(howToUseSrc);
  }
  const rootLicenseSrc = path.join(ROOT_DIR, 'LICENSE');
  if (fs.existsSync(rootLicenseSrc)) {
    runtimeZip.addLocalFile(rootLicenseSrc);
  }
  if (fs.existsSync(thirdPartyLicenseSrc)) {
    runtimeZip.addLocalFile(thirdPartyLicenseSrc);
  }
  runtimeZip.addLocalFolder(DIST_RUNTIME_APP_DIR, 'mkmv-runtime');
  runtimeZip.writeZip(DIST_RUNTIME_ZIP_PATH);

  // 10. Create Artifact 2: Portable Package (mkmv-portable-v*.zip and legacy mkmv-v*.zip)
  console.log(`[mkmv] Creating Portable Package zip: dist/${PORTABLE_ZIP_NAME}...`);
  const portableZip = new AdmZip();
  portableZip.addLocalFile(launcherDest);
  if (fs.existsSync(howToUseSrc)) {
    portableZip.addLocalFile(howToUseSrc);
  }
  if (fs.existsSync(rootLicenseSrc)) {
    portableZip.addLocalFile(rootLicenseSrc);
  }
  if (fs.existsSync(thirdPartyLicenseSrc)) {
    portableZip.addLocalFile(thirdPartyLicenseSrc);
  }
  portableZip.addLocalFolder(DIST_PORTABLE_APP_DIR, 'mkmv');
  portableZip.writeZip(DIST_PORTABLE_ZIP_PATH);

  // Legacy fallback copy
  fs.copyFileSync(DIST_PORTABLE_ZIP_PATH, DIST_LEGACY_ZIP_PATH);

  const runtimeStat = fs.statSync(DIST_RUNTIME_ZIP_PATH);
  const portableStat = fs.statSync(DIST_PORTABLE_ZIP_PATH);

  console.log('========================================================');
  console.log(`[mkmv] Dual build finished successfully!`);
  console.log(`[mkmv] 1. Runtime Package:  ${DIST_RUNTIME_ZIP_PATH} (${(runtimeStat.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`[mkmv] 2. Portable Package: ${DIST_PORTABLE_ZIP_PATH} (${(portableStat.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`[mkmv]    (Legacy alias:    ${DIST_LEGACY_ZIP_PATH})`);
  console.log('========================================================');
}

build().catch(err => {
  console.error('[mkmv] Build failed:', err);
  process.exit(1);
});
