import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveCliRuntimeModule } from './resolveCliRuntimeModule';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-cli-runtime-module-'));
  roots.push(root);
  return root;
}

describe('resolveCliRuntimeModule', () => {
  it('从仓库 cwd 解析独立 Runtime bundle 与 development root', () => {
    const root = createRoot();
    const modulePath = path.join(root, 'dist', 'main', 'linnya-cli-runtime.cjs');
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(modulePath, 'module.exports = {}');
    expect(resolveCliRuntimeModule({
      processEntryPath: undefined,
      workingDirectory: root,
      configuredModulePath: undefined,
      configuredDevelopmentRoot: undefined,
    })).toEqual({ modulePath, developmentRoot: root });
  });

  it('显式 module 必须同时给出 development root，不能从任意产物路径猜仓库', () => {
    const root = createRoot();
    const modulePath = path.join(root, 'runtime.cjs');
    fs.writeFileSync(modulePath, 'module.exports = {}');
    expect(() => resolveCliRuntimeModule({
      processEntryPath: undefined,
      workingDirectory: root,
      configuredModulePath: modulePath,
      configuredDevelopmentRoot: undefined,
    })).toThrow('LINNYA_CLI_DEVELOPMENT_ROOT');
  });

  it('缺少构建产物时明确失败，不回退到完整源码 import', () => {
    const root = createRoot();
    expect(() => resolveCliRuntimeModule({
      processEntryPath: path.join(root, 'apps', 'linnya-cli', 'bin', 'linnya.cjs'),
      workingDirectory: root,
      configuredModulePath: undefined,
      configuredDevelopmentRoot: undefined,
    })).toThrow('pnpm build:linnya-runtime');
  });
});
