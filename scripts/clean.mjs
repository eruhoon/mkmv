import fs from 'node:fs';
import path from 'node:path';

const DIST_DIR = path.resolve('dist');
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  console.log('[mkmv] Cleaned dist directory.');
}
