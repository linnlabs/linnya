import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { slidesBrowserBundleGuard } from './scripts/build/browserBundleGuard.mjs';
import { createViteBundleTracePlugin } from '../../../scripts/build/bundle-trace/adapters/viteBundleTracePlugin.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../../..');
const workerRoot = path.resolve(
  packageDir,
  'src/renderer/features/brushArtworkGeneration/worker',
);

export default defineConfig({
  root: workerRoot,
  base: './',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    process: 'undefined',
  },
  plugins: [
    slidesBrowserBundleGuard({ target: 'brush-worker', maxChunkBytes: 900_000 }),
    createViteBundleTracePlugin({
      buildTarget: 'plugin-slides/brush-worker',
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
    ],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    outDir: path.resolve(packageDir, 'dist/brush-worker'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(workerRoot, 'worker.html'),
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});
