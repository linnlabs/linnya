import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { discoverWorkspaceRendererOptimizeDependencies } from '../functions/discoverWorkspaceRendererOptimizeDependencies.mjs';

const tempRoots = [];

function writePackage(repositoryRoot, relativeDirectory, packageJson) {
  const packageDir = path.join(repositoryRoot, relativeDirectory);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), `${JSON.stringify(packageJson)}\n`);
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('workspace renderer dependency optimization discovery', () => {
  it('按各自 package 的 node_modules 解析优化输入，不借用根依赖', () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-renderer-deps-'));
    tempRoots.push(repositoryRoot);
    writePackage(repositoryRoot, 'packages/plugins/second', {
      dependencies: { 'visualization-package': '1.0.0' },
      linnya: {
        development: {
          rendererOptimizeDependencies: ['visualization-package/subpath'],
        },
      },
    });
    writePackage(repositoryRoot, 'packages/plugins/first', {
      dependencies: { '@scope/editor': '1.0.0' },
      linnya: {
        development: {
          rendererOptimizeDependencies: ['@scope/editor'],
        },
      },
    });

    writePackage(repositoryRoot, 'packages/parser', {
      dependencies: { '@scope/editor': '2.0.0' },
      linnya: { development: { rendererOptimizeDependencies: ['@scope/editor'] } },
    });

    expect(discoverWorkspaceRendererOptimizeDependencies(repositoryRoot)).toEqual([
      path.join(repositoryRoot, 'packages/parser/node_modules/@scope/editor'),
      path.join(repositoryRoot, 'packages/plugins/first/node_modules/@scope/editor'),
      path.join(repositoryRoot, 'packages/plugins/second/node_modules/visualization-package/subpath'),
    ]);
  });

  it('拒绝由根依赖暗中供给插件优化项', () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-renderer-deps-'));
    tempRoots.push(repositoryRoot);
    writePackage(repositoryRoot, 'packages/plugins/phantom', {
      linnya: {
        development: {
          rendererOptimizeDependencies: ['undeclared-package'],
        },
      },
    });

    expect(() => discoverWorkspaceRendererOptimizeDependencies(repositoryRoot)).toThrow(
      'Renderer 优化项 undeclared-package 必须由 package 自己的依赖字段声明'
    );
  });
});
