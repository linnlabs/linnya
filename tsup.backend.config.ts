import { defineConfig } from 'tsup';

import { createTsupBundleTrace } from './scripts/build/bundle-trace/adapters/tsupBundleTracePlugin.mjs';

const bundleTrace = createTsupBundleTrace({
  buildTarget: 'desktop/app-server',
  repositoryRoot: import.meta.dirname,
});

export default defineConfig({
  entry: {
    'app-server-entry': 'src/app-hosts/linnya/app-server-runtime/entry/appServerProcessEntry.ts',
    'app-server-backend': 'src/app-hosts/linnya/app-server-runtime/entry/appServerBackendEntry.ts',
  },
  format: ['cjs'],
  platform: 'node',
  outDir: 'dist/main',
  // Backend 产物由 Electron 主进程通过 CJS require 加载。linkedom 的 DOM 链和
  // AI SDK 7/Provider packages 都含纯 ESM 入口，必须在这里完成 CJS bundle 转换，
  // 不能把格式桥接责任推给 v8-compile-cache 或运行时动态加载。
  // App Server 由独立 Node 从 app.asar.unpacked 执行，不能像 Electron 一样解析 asar
  // 内的普通 node_modules。除原生/运行时加载模块外全部内联，发布目录只需解包真实物理依赖。
  noExternal: [
    /^(?!(?:electron|electron-store|better-sqlite3|yoga-layout|sharp|@node-rs\/jieba|@napi-rs\/canvas|pdfjs-dist|canvas)(?:$|\/)).*/,
  ],
  // sharp 是 N-API 原生模块（@img/* 预编译二进制），必须 external 从 node_modules 运行时解析，
  // 禁止打进 bundle（官方要求，与 better-sqlite3 同理；sharp 无需 electron-rebuild）。
  external: [
    'electron',
    'electron-store',
    'better-sqlite3',
    'yoga-layout',
    'sharp',
    '@node-rs/jieba',
    '@node-rs/jieba/dict',
    '@napi-rs/canvas',
    'pdfjs-dist',
    'canvas',
  ],
  esbuildPlugins: bundleTrace.esbuildPlugins,
  plugins: bundleTrace.plugins,
});
