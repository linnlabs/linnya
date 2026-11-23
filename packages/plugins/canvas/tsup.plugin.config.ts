import path from 'node:path';
import { defineConfig } from 'tsup';
import { createTsupBundleTrace } from '../../../scripts/build/bundle-trace/adapters/tsupBundleTracePlugin.mjs';
import { canvasBundleMetadata } from './scripts/build/canvasBundleMetadata';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
// 正式构建要求每个随包插件都有 bundle trace；每个产物各记一份，目标名小写连字符。
function traced(name: string, esbuildPlugins: NonNullable<import('tsup').Options['esbuildPlugins']>) {
  const trace = createTsupBundleTrace({ buildTarget: `plugin-canvas/${name}`, repositoryRoot });
  return { esbuildPlugins: [...esbuildPlugins, ...trace.esbuildPlugins], plugins: trace.plugins };
}

const common = {
  format: ['cjs' as const], platform: 'node' as const, target: 'node24',
  outDir: 'dist/backend', clean: false, splitting: false, tsconfig: 'tsconfig.json',
  external: [/^@app\/schemas(?:\/|$)/, /^@plugin\/backend\//],
  noExternal: ['zod', 'fractional-indexing', '@linnya/markdown-document-core', '@linnya/foundation'],
  outExtension: () => ({ js: '.cjs' }),
};
export default defineConfig([
  // preload 与 backend 共用清理目录，必须由同一次构建/监听生成，不能留到另一个脚本补齐。
  // 渲染 Worker 是 sandbox 窗口，preload 只能 require electron；@app/schemas 等依赖必须内联，verify-artifact 会检查。
  { ...common, ...traced('preload', [canvasBundleMetadata('preload')]), entry: { 'render-worker-preload': 'src/backend/features/canvasRender/infrastructure/preload.ts' },
    external: ['electron'], noExternal: [...common.noExternal, /^@app\/schemas(?:\/|$)/] },
  { ...common, ...traced('backend', [canvasBundleMetadata('backend')]), entry: { index: 'src/backend/index.ts' } },
  { ...common, ...traced('cli', [canvasBundleMetadata('cli')]), outDir: 'dist/cli', entry: { 'canvas-cli': 'src/cli/index.ts' }, external: ['electron', 'better-sqlite3'], esbuildOptions(options) {
    // 和现有独立CLI一样，只内联公开且无App装配依赖的SDK入口；不保留虚拟Host specifier。
    options.alias = { '@plugin/backend/workspaceDatabasePath': path.resolve('../../../src/plugin-sdk/backend/workspaceDatabasePath.ts'),
      '@plugin/backend/workspaceDocumentProjection': path.resolve('../../../src/plugin-sdk/backend/workspaceDocumentProjection.ts'),
      '@plugin/backend/semanticTags': path.resolve('../../../src/plugin-sdk/backend/semanticTags.ts') };
    // Host对native模块的白名单解析基于CJS；保留懒加载，但不要绕到Node的ESM package resolver。
    options.supported = { ...options.supported, 'dynamic-import': false };
  }, noExternal: [...common.noExternal, /^@app\/schemas(?:\/|$)/] },
  { ...common, ...traced('computation', [canvasBundleMetadata('computation')]), entry: { 'canvas-computation-worker': 'src/backend/orchestration/canvasComputationWorker.ts' }, external: [], noExternal: [...common.noExternal, 'elkjs', /^@app\/schemas(?:\/|$)/] },
]);
