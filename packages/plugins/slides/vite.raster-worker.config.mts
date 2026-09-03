import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { createViteBundleTracePlugin } from '../../../scripts/build/bundle-trace/adapters/viteBundleTracePlugin.mjs';
import {
  resolveSlidesBrowserManualChunk,
  slidesBrowserBundleGuard,
} from './scripts/build/browserBundleGuard.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../../..');
const workerRoot = path.resolve(
  packageDir,
  'src/renderer/features/slideRasterization/worker',
);

export default defineConfig({
  root: workerRoot,
  base: './',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    process: 'undefined',
  },
  plugins: [
    slidesBrowserBundleGuard({ target: 'raster-worker' }),
    createViteBundleTracePlugin({
      buildTarget: 'plugin-slides/raster-worker',
      repositoryRoot: repoRoot,
    }),
  ],
  resolve: {
    alias: [
      {
        find: /^@plugin\/slides\/shared$/,
        replacement: path.resolve(packageDir, 'src/shared/index.ts'),
      },
      {
        find: /^@plugin\/slides\/shared\/(.+)$/,
        replacement: path.resolve(packageDir, 'src/shared/$1'),
      },
      {
        find: /^@linnya\/renderer-ui\/font-stack$/,
        replacement: path.resolve(packageDir, '../../renderer-ui/src/features/font-stack/index.ts'),
      },
      {
        find: '@plugin/renderer/imageAssetSource',
        replacement: path.resolve(workerRoot, 'imageAssetSourceStub.ts'),
      },
    ],
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    outDir: path.resolve(packageDir, 'dist/raster-worker'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(workerRoot, 'worker.html'),
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        manualChunks: resolveSlidesBrowserManualChunk,
      },
    },
  },
});
