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
const DIST_APP_DIR = path.join(DIST_DIR, 'mkmv');
const ZIP_NAME = `mkmv-v${pkg.version}.zip`;
const DIST_ZIP_PATH = path.join(DIST_DIR, ZIP_NAME);

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

async function build() {
  console.log('========================================================');
  console.log(`[mkmv] Starting build for RPG Maker MV (Electron v${ELECTRON_VERSION})`);
  console.log('========================================================');

  // 1. Ensure directories exist
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_APP_DIR, { recursive: true });

  // 2. Download runtime if not cached
  if (!fs.existsSync(ELECTRON_ZIP_PATH)) {
    await downloadFile(ELECTRON_URL, ELECTRON_ZIP_PATH);
  } else {
    console.log(`[mkmv] Using cached runtime: ${ELECTRON_ZIP_PATH}`);
  }

  // 3. Extract Electron runtime
  console.log('[mkmv] Extracting Electron runtime into dist/mkmv...');
  const zip = new AdmZip(ELECTRON_ZIP_PATH);
  zip.extractAllTo(DIST_APP_DIR, true);

  // 4. WebGL 및 SwiftShader 가속 라이브러리는 RPG Maker MZ 구동을 위해 보존
  console.log('[mkmv] Preserved WebGL/SwiftShader driver libraries for MZ compatibility.');

  // 5. Copy template files
  console.log('[mkmv] Copying template source files...');
  const templateFiles = [
    'main.js',
    'preload.js',
    'keymap.gptk',
    'port.json',
    'package.json',
    'config.json'
  ];

  for (const file of templateFiles) {
    const src = path.join(TEMPLATE_DIR, file);
    const dest = path.join(DIST_APP_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }

  // Copy template directories if exist (fonts, conf, share, lib)
  const templateDirs = ['fonts', 'conf', 'share', 'lib'];
  for (const dirName of templateDirs) {
    const srcDir = path.join(TEMPLATE_DIR, dirName);
    const destDir = path.join(DIST_APP_DIR, dirName);
    if (fs.existsSync(srcDir)) {
      fs.cpSync(srcDir, destDir, { recursive: true });
      console.log(`[mkmv] Copied template/${dirName} to dist/mkmv/${dirName}.`);
    }
  }

  // Copy launcher to dist root with strict Unix LF line endings and no BOM
  const launcherSrc = path.join(TEMPLATE_DIR, 'mkmv.sh');
  const launcherDest = path.join(DIST_DIR, 'mkmv.sh');
  let launcherContent = fs.readFileSync(launcherSrc, 'utf8');
  if (launcherContent.charCodeAt(0) === 0xFEFF) {
    launcherContent = launcherContent.slice(1);
  }
  launcherContent = launcherContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  fs.writeFileSync(launcherDest, launcherContent, { encoding: 'utf8', flag: 'w' });

  // Ensure www and save directories with .gitkeep
  const wwwDir = path.join(DIST_APP_DIR, 'www');
  const saveDir = path.join(wwwDir, 'save');
  fs.mkdirSync(saveDir, { recursive: true });
  fs.writeFileSync(path.join(wwwDir, '.gitkeep'), '');
  fs.writeFileSync(path.join(saveDir, '.gitkeep'), '');

  console.log('[mkmv] Template files copied successfully.');

  // 6. Create PortMaster distribution zip
  console.log(`[mkmv] Creating distribution zip: dist/${ZIP_NAME}...`);
  const distZip = new AdmZip();
  distZip.addLocalFile(launcherDest);
  const howToUseSrc = path.join(ROOT_DIR, 'HOW_TO_USE.md');
  if (fs.existsSync(howToUseSrc)) {
    distZip.addLocalFile(howToUseSrc);
  }
  distZip.addLocalFolder(DIST_APP_DIR, 'mkmv');

  distZip.writeZip(DIST_ZIP_PATH);

  const stat = fs.statSync(DIST_ZIP_PATH);
  console.log('========================================================');
  console.log(`[mkmv] Build finished successfully!`);
  console.log(`[mkmv] Output zip: ${DIST_ZIP_PATH}`);
  console.log(`[mkmv] Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
  console.log('========================================================');
}

build().catch(err => {
  console.error('[mkmv] Build failed:', err);
  process.exit(1);
});
