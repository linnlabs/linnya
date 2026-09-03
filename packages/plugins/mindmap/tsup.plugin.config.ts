import { defineConfig } from 'tsup';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTsupBundleTrace } from '../../../scripts/build/bundle-trace/adapters/tsupBundleTracePlugin.mjs';

const hostBackendExternal = /^@plugin\/backend\//;
const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(packageDir, '../../..');
const bundleTrace = createTsupBundleTrace({
  buildTarget: 'plugin-mindmap/backend',
  repositoryRoot,
});

export default defineConfig({
  entry: {
    index: 'src/backend/index.ts',
  },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist/backend',
  clean: true,
  splitting: false,
  treeshake: true,
  tsconfig: 'tsconfig.json',
  external: ['electron', 'better-sqlite3', '@app/schemas', hostBackendExternal],
  noExternal: ['uuid'],
  esbuildPlugins: bundleTrace.esbuildPlugins,
  plugins: bundleTrace.plugins,
  outExtension() {
    return {
      js: '.cjs',
    };
  },
});
