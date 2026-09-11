import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { defineConfig } from 'vite';
import rasterConfig from './vite.raster-worker.config.mts';

// 复用生产 browser-safe alias，但独立输出，不覆盖 Renderer/raster worker 产物。
export default defineConfig({
  root: path.resolve(import.meta.dirname, 'dev/fixtures'),
  base: './',
  plugins: [vue()],
  resolve: { ...rasterConfig.resolve, dedupe: ['vue', 'konva'] },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/dev/preview-transitions'),
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(import.meta.dirname, 'dev/fixtures/previewTransitionSmoke.html') },
  },
});
