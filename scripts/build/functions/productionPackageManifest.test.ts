import { describe, expect, it } from 'vitest';

import { projectProductionPackageManifest } from './productionPackageManifest.mjs';

const workspaceDependencies = {
  '@linnlabs/linnkit-provider-ai-sdk': 'workspace:*',
  '@linnya/provider-catalog': 'workspace:*',
  '@linnya/renderer-ui': 'workspace:*',
  'parser-wasm': 'workspace:*',
} as const;

describe('production package manifest', () => {
  it('只移除已经编入生产 artifact 的 workspace package', () => {
    const source = {
      name: 'linnya',
      overrides: { 'tar@6': '7.5.22' },
      dependencies: {
        ...workspaceDependencies,
        '@app/schemas': 'file:./packages/schemas',
        zod: '^3.25.0',
      },
      devDependencies: { electron: '43.4.0' },
      scripts: { postinstall: 'do-not-copy-this' },
      lintStaged: { '*': 'do-not-copy-this' },
    };
    expect(projectProductionPackageManifest(source)).toEqual({
      name: 'linnya',
      overrides: { 'tar@6': '7.5.22' },
      dependencies: {
        '@app/schemas': 'file:./packages/schemas',
        zod: '^3.25.0',
      },
      devDependencies: { electron: '43.4.0' },
    });
    expect(source.dependencies).toMatchObject(workspaceDependencies);
  });

  it('拒绝新增但未登记处置的 workspace dependency', () => {
    expect(() =>
      projectProductionPackageManifest({
        dependencies: { ...workspaceDependencies, '@linnya/new-runtime': 'workspace:*' },
        devDependencies: { electron: '43.4.0' },
      })
    ).toThrow('仍含未处置 workspace 依赖');
  });

  it('拒绝已登记 package 的开发合同静默漂移', () => {
    expect(() =>
      projectProductionPackageManifest({
        dependencies: { ...workspaceDependencies, '@linnya/renderer-ui': '^2.0.0' },
        devDependencies: { electron: '43.4.0' },
      })
    ).toThrow('预期 @linnya/renderer-ui=workspace:*');
  });

  it('拒绝 Electron 范围版本，避免 release runtime 漂移', () => {
    expect(() =>
      projectProductionPackageManifest({
        dependencies: workspaceDependencies,
        devDependencies: { electron: '^43.4.0' },
      })
    ).toThrow('精确 Electron 版本');
  });
});
