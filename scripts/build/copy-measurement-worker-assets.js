import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

export async function copyMeasurementWorkerAssets() {
  const sourcePath = path.join(rootDir, 'src', 'electron-main', 'measurement', 'worker.html');
  const destinationDir = path.join(rootDir, 'dist', 'main');
  const destinationPath = path.join(destinationDir, 'worker.html');

  await fs.ensureDir(destinationDir);
  await fs.copy(sourcePath, destinationPath);
  console.log(`[copy-measurement-worker-assets] Copied ${sourcePath} -> ${destinationPath}`);
}

const isDirectExecution = process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  copyMeasurementWorkerAssets().catch((error) => {
    console.error('[copy-measurement-worker-assets] Failed:', error);
    process.exit(1);
  });
}
