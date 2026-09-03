import { describe, expect, it } from 'vitest';
import { resolveSlidesRasterWorkerPaths } from './resolveSlidesRasterWorkerPaths';

describe('resolveSlidesRasterWorkerPaths', () => {
  it('resolves only the explicit source-development package root', () => {
    const expected = {
      workerHtmlPath: '/repo/packages/plugins/slides/dist/raster-worker/worker.html',
      preloadPath: '/repo/packages/plugins/slides/dist/backend/raster-worker-preload.cjs',
    };

    expect(resolveSlidesRasterWorkerPaths({
      runtime: {
        mode: 'source-development',
        packageRoot: '/repo/packages/plugins/slides',
        rootSource: 'workspace',
      },
      fileExists: (candidate) => Object.values(expected).includes(candidate),
    })).toEqual(expected);
  });

  it('resolves an installed worker only from its own artifact root', () => {
    const expected = {
      workerHtmlPath: '/plugins/slides/1.0.3/dist/raster-worker/worker.html',
      preloadPath: '/plugins/slides/1.0.3/dist/backend/raster-worker-preload.cjs',
    };

    expect(resolveSlidesRasterWorkerPaths({
      runtime: {
        mode: 'artifact-runtime',
        packageRoot: '/plugins/slides/1.0.3',
        rootSource: 'backend-bundle',
      },
      fileExists: (candidate) => Object.values(expected).includes(candidate),
    })).toEqual(expected);
  });

  it('fails when one managed file is missing instead of falling back to another root', () => {
    expect(() => resolveSlidesRasterWorkerPaths({
      runtime: {
        mode: 'source-development',
        packageRoot: '/repo/packages/plugins/slides',
        rootSource: 'workspace',
      },
      fileExists: (candidate) => candidate.endsWith('/raster-worker/worker.html'),
    })).toThrow(
      'Slides raster worker artifact is incomplete mode=source-development rootSource=workspace missing=dist/backend/raster-worker-preload.cjs',
    );
  });
});
