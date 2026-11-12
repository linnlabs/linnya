import path from 'node:path';
import { defineConfig } from 'tsup';
import { canvasBundleMetadata } from './scripts/build/canvasBundleMetadata';

const common = {
  format: ['cjs' as const], platform: 'node' as const, target: 'node24',
  outDir: 'dist/backend', clean: false, splitting: false, tsconfig: 'tsconfig.json',
  external: [/^@app\/schemas(?:\/|$)/, /^@plugin\/backend\//],
  noExternal: ['zod', 'fractional-indexing', '@linnya/markdown-document-core', '@linnya/foundation'],
  outExtension: () => ({ js: '.cjs' }),
};
export default defineConfig([
  { ...common, esbuildPlugins: [canvasBundleMetadata('backend')], entry: { index: 'src/backend/index.ts' } },
  { ...common, esbuildPlugins: [canvasBundleMetadata('cli')], outDir: 'dist/cli', entry: { 'canvas-cli': 'src/cli/index.ts' }, external: ['electron', 'better-sqlite3'], esbuildOptions(options) {
    // 和现有独立CLI一样，只内联公开且无App装配依赖的SDK入口；不保留虚拟Host specifier。
    options.alias = { '@plugin/backend/workspaceDatabasePath': path.resolve('../../../src/plugin-sdk/backend/workspaceDatabasePath.ts'),
      '@plugin/backend/workspaceDocumentProjection': path.resolve('../../../src/plugin-sdk/backend/workspaceDocumentProjection.ts'),
      '@plugin/backend/semanticTags': path.resolve('../../../src/plugin-sdk/backend/semanticTags.ts') };
    // Host对native模块的白名单解析基于CJS；保留懒加载，但不要绕到Node的ESM package resolver。
    options.supported = { ...options.supported, 'dynamic-import': false };
  }, noExternal: [...common.noExternal, /^@app\/schemas(?:\/|$)/] },
  { ...common, esbuildPlugins: [canvasBundleMetadata('computation')], entry: { 'canvas-computation-worker': 'src/backend/orchestration/canvasComputationWorker.ts' }, external: [], noExternal: [...common.noExternal, 'elkjs', /^@app\/schemas(?:\/|$)/] },
]);
