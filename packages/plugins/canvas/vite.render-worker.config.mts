import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createViteBundleTracePlugin } from '../../../scripts/build/bundle-trace/adapters/viteBundleTracePlugin.mjs';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: path.join(packageRoot, 'src/renderer/hidden-render-worker'),
  base: './',
  plugins: [vue(), createViteBundleTracePlugin({
    buildTarget: 'plugin-canvas/render-worker', repositoryRoot: path.resolve(packageRoot, '../../..'),
  })],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { alias: [{ find: /^@plugin\/canvas\/shared$/, replacement: path.join(packageRoot, 'src/shared/index.ts') }] },
  build: {
    target: 'es2022', outDir: path.join(packageRoot, 'dist/render-worker'), emptyOutDir: true,
    rollupOptions: { input: path.join(packageRoot, 'src/renderer/hidden-render-worker/worker.html') },
  },
});
