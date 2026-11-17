import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { defineConfig } from 'vite';
import { isHostRendererExternal, resolveHostRendererExternalUrl } from '../../rendererHostExternalMap.mjs';
import { rendererStylesheetManifestPlugin } from '../../build/rendererStylesheetManifestPlugin';

const packageDir = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(packageDir, '../../..');
const rendererEntry = path.join(packageDir, 'src/renderer/index.ts');

export default defineConfig({
  root: packageDir,
  plugins: [vue(), rendererStylesheetManifestPlugin({ entryPath: rendererEntry })],
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), process: 'undefined' },
  resolve: { alias: [
    { find: /^@plugin\/knowledge\/shared$/, replacement: path.join(packageDir, 'src/shared/index.ts') },
    { find: /^@app\/schemas$/, replacement: path.join(repositoryRoot, 'packages/schemas/src/index.ts') },
    { find: /^@app\/schemas\/(.+)$/, replacement: path.join(repositoryRoot, 'packages/schemas/src/$1') },
    { find: /^@linnya\/foundation$/, replacement: path.join(repositoryRoot, 'packages/foundation/src/index.ts') },
  ], dedupe: ['vue', 'pinia'] },
  build: {
    target: 'es2020', outDir: path.join(packageDir, 'dist/renderer'), emptyOutDir: true,
    lib: { entry: rendererEntry, formats: ['es'], fileName: () => 'index.js' },
    rollupOptions: {
      external: isHostRendererExternal,
      output: { paths: resolveHostRendererExternalUrl, assetFileNames: 'assets/[name]-[hash][extname]', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
});
