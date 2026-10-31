/** Desktop 的 build/watch 共用同一配置；开发启动只改变 sourcemap 和成功事件接收方。 */
export const desktopEsbuildTargets = {
  main: {
    entryPoints: ['src/electron-main/index.js'],
    platform: 'node',
    outfile: 'dist/main/main.cjs',
    format: 'cjs',
    external: ['electron', 'pdfjs-dist', '@napi-rs/canvas', '@node-rs/jieba', 'better-sqlite3', 'yoga-layout', 'harfbuzzjs', 'sharp'],
  },
  preload: {
    entryPoints: ['src/electron-main/preload/index.ts'],
    platform: 'node',
    outfile: 'dist/main/preload.js',
    format: 'cjs',
    external: ['electron'],
  },
  'measurement-worker': {
    entryPoints: ['src/electron-main/measurement/worker-entry.ts'],
    platform: 'browser',
    outfile: 'dist/main/measurement-worker.js',
    format: 'esm',
  },
  'measurement-preload': {
    entryPoints: ['src/electron-main/measurement/preload.ts'],
    platform: 'node',
    outfile: 'dist/main/measurement-preload.js',
    format: 'cjs',
    external: ['electron'],
  },
};
