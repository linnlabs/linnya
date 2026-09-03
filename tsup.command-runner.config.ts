import { defineConfig } from 'tsup';

import { createTsupBundleTrace } from './scripts/build/bundle-trace/adapters/tsupBundleTracePlugin.mjs';

const bundleTrace = createTsupBundleTrace({
  buildTarget: 'desktop/command-runner',
  repositoryRoot: import.meta.dirname,
});

export default defineConfig({
  entry: {
    commandRunnerProcess: 'src/infra/adapters/command-runtime/runner/child/commandRunnerProcess.ts',
    commandRunnerUtilityProcess: 'src/infra/adapters/command-runtime/runner/child/commandRunnerUtilityProcess.ts',
  },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist/main/commands',
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  // node-pty 依赖自身目录定位目标架构的 native addon 与 spawn-helper。
  // 必须保留包边界，不能让 bundler 改写 __dirname 和原生文件查找语义。
  external: ['node-pty'],
  // SRT 是 ESM-only；普通 CJS utility 若留下 require() 会在 packaged App 启动失败。
  // 只内联实际依赖，Windows 自有 native runtime 仍通过 manifest 的绝对路径加载。
  noExternal: ['@app/schemas', '@anthropic-ai/sandbox-runtime', 'zod'],
  esbuildPlugins: bundleTrace.esbuildPlugins,
  plugins: bundleTrace.plugins,
  esbuildOptions(options) {
    // SRT 的平台辅助模块会在加载时读取 import.meta.url。CJS 没有该元数据，
    // 但 __filename 表达同一个“当前 bundle 文件”事实；显式注入避免 packaged
    // utility 在真正接收命令前因 undefined URL 崩溃。
    options.define = {
      ...options.define,
      'import.meta.url': '__linnyaCommandRunnerModuleUrl',
    };
    options.banner = {
      js: "const __linnyaCommandRunnerModuleUrl = require('node:url').pathToFileURL(__filename).href;",
    };
  },
});
