import path from 'node:path';
import type {
  BrushArtworkWorkerPaths,
  BrushArtworkWorkerRuntimeLocation,
} from '../definitions/brushArtworkWorkerPaths';

export function resolveBrushArtworkWorkerPaths(
  runtime: BrushArtworkWorkerRuntimeLocation,
): BrushArtworkWorkerPaths {
  const distRoot = path.resolve(runtime.packageRoot, 'dist');
  return {
    workerHtmlPath: path.join(distRoot, 'brush-worker', 'worker.html'),
    preloadPath: path.join(distRoot, 'backend', 'brush-worker-preload.cjs'),
  };
}
