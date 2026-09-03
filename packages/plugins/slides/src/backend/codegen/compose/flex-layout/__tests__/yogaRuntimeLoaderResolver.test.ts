import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  readYogaRuntimeLoader,
  type CreateRequireFactory,
  type CjsRequire,
  type YogaRuntimeLoaderModule,
} from '../YogaRuntimeLoaderResolver.js';

function createLoaderModule(): YogaRuntimeLoaderModule {
  return {
    async loadYoga() {
      throw new Error('test-only loader should not execute loadYoga');
    },
  };
}

describe('YogaRuntimeLoaderResolver', () => {
  it('uses relative CJS require when ambient require is available', () => {
    const loaderModule = createLoaderModule();
    const requestedIds: string[] = [];
    const cjsRequire: CjsRequire = (id) => {
      requestedIds.push(id);
      return loaderModule;
    };

    const resolved = readYogaRuntimeLoader({
      cjsRequire,
      cwd: '/repo',
      createRequireFactory: () => {
        throw new Error('createRequire should not be called in CJS mode');
      },
    });

    expect(resolved).toBe(loaderModule);
    expect(requestedIds).toEqual(['./yogaRuntimeLoader.cjs']);
  });

  it('loads the source helper by absolute path when ambient require is unavailable', () => {
    const loaderModule = createLoaderModule();
    const requestedIds: string[] = [];
    const createRequireBases: Array<string | URL> = [];
    const createRequireFactory: CreateRequireFactory = (filename) => {
      createRequireBases.push(filename);
      return (id) => {
        requestedIds.push(id);
        return loaderModule;
      };
    };

    const resolved = readYogaRuntimeLoader({
      cjsRequire: null,
      cwd: '/repo',
      createRequireFactory,
    });

    const expectedLoaderPath = path.resolve(
      '/repo',
      'packages',
      'plugins',
      'slides',
      'src',
      'backend',
      'codegen',
      'compose',
      'flex-layout',
      'yogaRuntimeLoader.cjs',
    );
    expect(resolved).toBe(loaderModule);
    expect(createRequireBases).toEqual([expectedLoaderPath]);
    expect(requestedIds).toEqual([expectedLoaderPath]);
  });

  it('throws a clear error when the helper module shape is invalid', () => {
    const cjsRequire: CjsRequire = () => ({});

    expect(() =>
      readYogaRuntimeLoader({
        cjsRequire,
        cwd: '/repo',
      })
    ).toThrowError('yogaRuntimeLoader.cjs 未导出 loadYoga()。');
  });
});
