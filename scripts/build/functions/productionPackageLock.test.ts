import { describe, expect, it } from 'vitest';

import { assertProductionPackageLock } from './productionPackageLock.mjs';

const manifest = {
  name: 'linnya',
  version: '1.0.0',
  dependencies: { '@app/schemas': 'file:./packages/schemas', zod: '^3.25.0' },
  devDependencies: { electron: '43.4.0' },
} as const;

function createLock() {
  return {
    name: 'linnya',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'linnya',
        version: '1.0.0',
        dependencies: manifest.dependencies,
        devDependencies: manifest.devDependencies,
      },
      'node_modules/zod': {
        version: '3.25.76',
        resolved: 'https://registry.npmjs.org/zod/-/zod-3.25.76.tgz',
        integrity: 'sha512-example',
      },
      'packages/schemas': {
        name: '@app/schemas',
        version: '1.0.0',
      },
    },
  };
}

describe('production package lock', () => {
  it('接受与投影 manifest 一致的 npm v3 lock', () => {
    expect(assertProductionPackageLock(createLock(), manifest)).toEqual(createLock());
  });

  it('拒绝过期的直接依赖集', () => {
    const current = createLock();
    const lock = {
      ...current,
      packages: {
        ...current.packages,
        '': { ...current.packages[''], dependencies: { zod: '^4.0.0' } },
      },
    };
    expect(() => assertProductionPackageLock(lock, manifest)).toThrow('dependencies');
  });

  it('拒绝 workspace 协议和开发机绝对路径', () => {
    expect(() =>
      assertProductionPackageLock({ ...createLock(), marker: 'workspace:*' }, manifest)
    ).toThrow('workspace');
    expect(() =>
      assertProductionPackageLock(
        { ...createLock(), marker: 'file:/Users/person/repo/packages/schemas' },
        manifest
      )
    ).toThrow('绝对路径');
  });
});
