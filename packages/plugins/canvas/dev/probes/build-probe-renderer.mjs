import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

/** 探针复用正式Vite/SFC编译，不在测试里复制RendererUI图标路径或维护第二套Vue编译器。 */
export async function buildProbeRenderer({ entry, root, output }) {
  await build({
    configFile: false, root: path.dirname(entry), base: './', logLevel: 'warn', plugins: [vue()],
    define: { 'process.env.NODE_ENV': '"production"' },
    resolve: { alias: [
      { find: /^@plugin\/canvas\/shared$/, replacement: path.join(root, 'packages/plugins/canvas/src/shared/index.ts') },
      { find: /^@app\/schemas$/, replacement: path.join(root, 'packages/schemas/src/index.ts') },
    ], dedupe: ['vue'] },
    build: {
      target: 'es2022', outDir: output, emptyOutDir: false,
      lib: { entry, name: 'CanvasNativeProbe', formats: ['iife'], fileName: () => 'renderer.js', cssFileName: 'renderer' },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
}
