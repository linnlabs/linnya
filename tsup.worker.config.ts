import { defineConfig } from 'tsup';

import { createTsupBundleTrace } from './scripts/build/bundle-trace/adapters/tsupBundleTracePlugin.mjs';

const bundleTrace = createTsupBundleTrace({
  buildTarget: 'desktop/task-workers',
  repositoryRoot: import.meta.dirname,
});

export default defineConfig({
  entry: ['src/infra/task-queue/workers/*.worker.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  splitting: false,
  // PDF.js 与 @napi-rs/canvas 都从生产依赖树运行时解析；后者包含平台原生二进制，
  // 不能打进 CJS worker bundle。
  external: ['electron', 'pdfjs-dist', '@napi-rs/canvas'],
  // Worker 是独立 CJS 入口，无法从公开安装包中的 workspace 软链取包。
  // 这些本地 package 属于编译期模块边界，生产字节必须被各 worker 自己携带；
  // 普通 npm 运行时依赖仍保持 external，由 Desktop 的生产依赖树统一安装。
  noExternal: [
    '@linnlabs/linnkit-provider-ai-sdk',
    /^@linnlabs\/linnkit(?:\/|$)/u,
    /^@linnya\/provider-catalog(?:\/|$)/u,
  ],
  esbuildPlugins: bundleTrace.esbuildPlugins,
  plugins: bundleTrace.plugins,
});
