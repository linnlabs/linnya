import { describe, expect, it } from 'vitest';

import { productionRuntimeDependencyNames } from '../definitions/productionRuntimeDependencies.mjs';
import { projectProductionPackageManifest } from './productionPackageManifest.mjs';

const runtimeDependencies = Object.fromEntries(
  productionRuntimeDependencyNames.map(name => [name, '1.0.0'])
);

describe('production package manifest', () => {
  it('只保留运行时从 node_modules 加载的依赖，已内联的包和 workspace 包不进入安装清单', () => {
    const source = {
      name: 'linnya',
      overrides: { 'tar@6': '7.5.22' },
      dependencies: {
        ...runtimeDependencies,
        '@linnya/renderer-ui': 'workspace:*',
        echarts: '^6.1.0',
        zod: '^3.25.0',
      },
      devDependencies: { electron: '43.4.0', vitest: '^4.0.0' },
      scripts: { postinstall: 'do-not-copy-this' },
      lintStaged: { '*': 'do-not-copy-this' },
    };
    expect(projectProductionPackageManifest(source)).toEqual({
      name: 'linnya',
      overrides: { 'tar@6': '7.5.22' },
      dependencies: runtimeDependencies,
      devDependencies: { electron: '43.4.0' },
    });
  });

  it('运行时依赖从根 dependencies 消失时拒绝投影，不让安装包悄悄少一个包', () => {
    const withoutSharp = { ...runtimeDependencies };
    delete withoutSharp.sharp;
    expect(() =>
      projectProductionPackageManifest({
        dependencies: withoutSharp,
        devDependencies: { electron: '43.4.0' },
      })
    ).toThrow('需要根 dependencies 声明 sharp');
  });

  it('拒绝把 workspace 协议交给 npm', () => {
    expect(() =>
      projectProductionPackageManifest({
        dependencies: { ...runtimeDependencies, sharp: 'workspace:*' },
        devDependencies: { electron: '43.4.0' },
      })
    ).toThrow('仍含未处置 workspace 依赖');
  });

  it('拒绝 Electron 范围版本，避免 release runtime 漂移', () => {
    expect(() =>
      projectProductionPackageManifest({
        dependencies: runtimeDependencies,
        devDependencies: { electron: '^43.4.0' },
      })
    ).toThrow('精确 Electron 版本');
  });
});
