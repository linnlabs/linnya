import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { isHostRendererExternal, resolveHostRendererExternalUrl } from '../rendererHostExternalMap.mjs';
import { rendererStylesheetManifestPlugin } from '../build/rendererStylesheetManifestPlugin';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const rendererEntry = path.join(packageDir, 'src/renderer/index.ts');
export default defineConfig({
  root: packageDir,
  plugins: [rendererStylesheetManifestPlugin({ entryPath: rendererEntry })],
  resolve: { alias: [{ find: /^@app\/schemas\/(.+)$/, replacement: path.resolve(packageDir, '../../schemas/src/$1') }], dedupe: ['vue'] },
  build: {
    target: 'es2020', outDir: path.join(packageDir, 'dist/renderer'), emptyOutDir: true,
    lib: { entry: rendererEntry, formats: ['es'], fileName: () => 'index.js' },
    rollupOptions: { external: isHostRendererExternal, output: { paths: resolveHostRendererExternalUrl } },
  },
});
