import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { defineConfig } from 'vite';
import { isHostRendererExternal, resolveHostRendererExternalUrl } from '../rendererHostExternalMap.mjs';
import { rendererStylesheetManifestPlugin } from '../build/rendererStylesheetManifestPlugin';
const packageDir = import.meta.dirname;
const repository = path.resolve(packageDir, '../../..');
const rendererEntry = path.resolve(packageDir, 'src/renderer/index.ts');
export default defineConfig({
  root: packageDir,
  plugins: [vue(), rendererStylesheetManifestPlugin({ entryPath: rendererEntry })],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { alias: [
    { find: /^@plugin\/canvas\/shared$/, replacement: path.resolve(packageDir, 'src/shared/index.ts') },
    { find: /^@app\/schemas$/, replacement: path.resolve(repository, 'packages/schemas/src/index.ts') },
    { find: /^@app\/schemas\/(.+)$/, replacement: path.resolve(repository, 'packages/schemas/src/$1') },
  ], dedupe: ['vue', 'pinia'] },
  build: { target: 'es2020', outDir: path.resolve(packageDir, 'dist/renderer'), emptyOutDir: true,
    lib: { entry: rendererEntry, formats: ['es'], fileName: () => 'index.js' },
    rollupOptions: { external: isHostRendererExternal, output: { paths: resolveHostRendererExternalUrl, assetFileNames: 'assets/[name]-[hash][extname]', chunkFileNames: 'chunks/[name]-[hash].js' } },
  },
});
