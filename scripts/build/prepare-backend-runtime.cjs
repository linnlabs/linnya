const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const mainBundleDirectory = path.join(rootDir, 'dist', 'main');
const runtimeLoaders = [
  {
    source: path.join(
      rootDir,
      'packages/plugins/slides/src/backend/codegen/compose/flex-layout/yogaRuntimeLoader.cjs',
    ),
    fileName: 'yogaRuntimeLoader.cjs',
  },
  {
    source: path.join(
      rootDir,
      'src/features/text-measurement/infrastructure/system/harfbuzzRuntimeLoader.cjs',
    ),
    fileName: 'harfbuzzRuntimeLoader.cjs',
  },
];

for (const obsoleteName of ['ts-backend.cjs', 'ts-backend.js', 'ts-backend.jsc']) {
  fs.rmSync(path.join(mainBundleDirectory, obsoleteName), { force: true });
}

for (const loader of runtimeLoaders) {
  const destination = path.join(mainBundleDirectory, loader.fileName);
  fs.copyFileSync(loader.source, destination);
  console.log(`[prepare-backend-runtime] Copied ${loader.fileName}`);
}
