import path from 'node:path';

/** 源码测试和独立制品是两个明确宿主模式；制品不依赖仓库 cwd。 */
export function resolveCanvasArtifactPaths() {
  const loading = process.env.LINNYA_PLUGIN_BACKEND_LOADING;
  const packageRoot = loading === 'disk' || loading === 'disk-only'
    ? path.resolve(__dirname, '../..')
    : path.resolve(process.cwd(), 'packages/plugins/canvas');
  return {
    computationWorkerPath: path.join(packageRoot, 'dist/backend/canvas-computation-worker.cjs'),
    workerHtmlPath: path.join(packageRoot, 'dist/render-worker/worker.html'),
    preloadPath: path.join(packageRoot, 'dist/backend/render-worker-preload.cjs'),
    skillResourceRoot: path.join(packageRoot, 'skills'),
  };
}
