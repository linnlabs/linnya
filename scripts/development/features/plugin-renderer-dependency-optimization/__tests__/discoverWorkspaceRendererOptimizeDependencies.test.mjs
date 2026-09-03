import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { discoverWorkspaceRendererOptimizeDependencies } from '../functions/discoverWorkspaceRendererOptimizeDependencies.mjs';

const tempRoots = [];

function writePlugin(repositoryRoot, directoryName, packageJson) {
  const packageDir = path.join(repositoryRoot, 'packages/plugins', directoryName);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), `${JSON.stringify(packageJson)}\n`);
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('workspace renderer dependency optimization discovery', () => {
  it('合并插件 owner 声明的依赖并保持确定顺序', () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-renderer-deps-'));
    tempRoots.push(repositoryRoot);
    writePlugin(repositoryRoot, 'second', {
      dependencies: { 'visualization-package': '1.0.0' },
      linnya: {
        development: {
          rendererOptimizeDependencies: ['visualization-package/subpath'],
        },
      },
    });
    writePlugin(repositoryRoot, 'first', {
      dependencies: { '@scope/editor': '1.0.0' },
      linnya: {
        development: {
          rendererOptimizeDependencies: ['@scope/editor'],
        },
      },
    });

    expect(discoverWorkspaceRendererOptimizeDependencies(repositoryRoot)).toEqual([
      '@scope/editor',
      'visualization-package/subpath',
    ]);
  });

  it('拒绝由根依赖暗中供给插件优化项', () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-renderer-deps-'));
    tempRoots.push(repositoryRoot);
    writePlugin(repositoryRoot, 'phantom', {
      linnya: {
        development: {
          rendererOptimizeDependencies: ['undeclared-package'],
        },
      },
    });

    expect(() => discoverWorkspaceRendererOptimizeDependencies(repositoryRoot)).toThrow(
      'Renderer 优化项 undeclared-package 必须由插件自己的依赖字段声明'
    );
  });
});
