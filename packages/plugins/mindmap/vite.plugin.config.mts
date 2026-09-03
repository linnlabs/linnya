import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { createViteBundleTracePlugin } from '../../../scripts/build/bundle-trace/adapters/viteBundleTracePlugin.mjs';
import {
  isHostRendererExternal,
  resolveHostRendererExternalUrl,
} from '../rendererHostExternalMap.mjs';
import { rendererStylesheetManifestPlugin } from '../build/rendererStylesheetManifestPlugin';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../../..');
const rendererEntry = path.resolve(packageDir, 'src/renderer/index.ts');

export default defineConfig({
  root: packageDir,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    process: 'undefined',
  },
  plugins: [
    vue(),
    rendererStylesheetManifestPlugin({ entryPath: rendererEntry }),
    createViteBundleTracePlugin({ buildTarget: 'plugin-mindmap/renderer', repositoryRoot: repoRoot }),
  ],
  resolve: {
    alias: [
      { find: /^@app\/schemas$/, replacement: path.resolve(repoRoot, 'packages/schemas/src/index.ts') },
      { find: /^@app\/schemas\/(.+)$/, replacement: path.resolve(repoRoot, 'packages/schemas/src/$1') },
      { find: /^@plugin\/mindmap\/shared$/, replacement: path.resolve(packageDir, 'src/shared/index.ts') },
      { find: /^@plugin\/mindmap\/shared\/(.+)$/, replacement: path.resolve(packageDir, 'src/shared/$1') },
    ],
    dedupe: ['vue', 'pinia'],
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    outDir: path.resolve(packageDir, 'dist/renderer'),
    emptyOutDir: true,
    lib: {
      entry: rendererEntry,
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: isHostRendererExternal,
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: 'index.js',
        paths: resolveHostRendererExternalUrl,
      },
    },
  },
});
