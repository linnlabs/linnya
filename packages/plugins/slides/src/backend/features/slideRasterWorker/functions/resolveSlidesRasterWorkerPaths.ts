import path from 'node:path';
import type {
  ResolveSlidesRasterWorkerPathsOptions,
  SlidesRasterWorkerPaths,
} from '../definitions/slidesRasterWorkerPaths';

export function resolveSlidesRasterWorkerPaths(
  options: ResolveSlidesRasterWorkerPathsOptions,
): SlidesRasterWorkerPaths {
  const paths = createPaths(path.resolve(options.runtime.packageRoot, 'dist'));
  const fileExists = options.fileExists;
  if (!fileExists) {
    return paths;
  }
  const missing = [
    ['dist/raster-worker/worker.html', paths.workerHtmlPath],
    ['dist/backend/raster-worker-preload.cjs', paths.preloadPath],
  ].filter(([, absolutePath]) => !fileExists(absolutePath));

  if (missing.length > 0) {
    throw new Error(
      'Slides raster worker artifact is incomplete'
      + ` mode=${options.runtime.mode}`
      + ` rootSource=${options.runtime.rootSource}`
      + ` missing=${missing.map(([relativePath]) => relativePath).join(',')}`,
    );
  }

  return paths;
}

function createPaths(distRoot: string): SlidesRasterWorkerPaths {
  return {
    workerHtmlPath: path.join(distRoot, 'raster-worker', 'worker.html'),
    preloadPath: path.join(distRoot, 'backend', 'raster-worker-preload.cjs'),
  };
}
