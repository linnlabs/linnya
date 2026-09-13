import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveAppDefaultModelsPath } from './resolveAppDefaultModelsPath';

const temporaryRoots: string[] = [];

function createTemporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'linnya-model-path-'));
  temporaryRoots.push(root);
  return root;
}

function createApplicationDefault(applicationPath: string): string {
  const modelPath = path.join(
    applicationPath,
    'dist',
    'domains',
    'model-catalog',
    'default_models.json',
  );
  mkdirSync(path.dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, '{"models":[]}\n', 'utf8');
  return modelPath;
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe('resolveAppDefaultModelsPath', () => {
  it('保留完整 App 或企业部署提供的有效绝对路径', () => {
    const root = createTemporaryRoot();
    const explicitPath = path.join(root, 'enterprise-models.json');
    writeFileSync(explicitPath, '{"models":[]}\n', 'utf8');
    createApplicationDefault(root);

    expect(resolveAppDefaultModelsPath({
      configuredPath: explicitPath,
      applicationPath: root,
      developmentRoot: root,
      isPackaged: true,
    })).toEqual({ path: explicitPath, source: 'explicit' });
  });

  it('显式路径是相对路径时直接失败', () => {
    const root = createTemporaryRoot();
    const relativeTarget = path.join(root, 'relative-models.json');
    writeFileSync(relativeTarget, '{"models":[]}\n', 'utf8');
    createApplicationDefault(root);

    expect(() => resolveAppDefaultModelsPath({
      configuredPath: path.relative(process.cwd(), relativeTarget),
      applicationPath: root,
      developmentRoot: root,
      isPackaged: true,
    })).toThrow('MODEL_REGISTRY_DEFAULTS_PATH');
  });

  it('显式路径不存在时直接失败', () => {
    const root = createTemporaryRoot();
    createApplicationDefault(root);

    expect(() => resolveAppDefaultModelsPath({
      configuredPath: path.join(root, 'missing-models.json'),
      applicationPath: root,
      developmentRoot: root,
      isPackaged: true,
    })).toThrow('MODEL_REGISTRY_DEFAULTS_PATH');
  });

  it('发布环境只读取 app.getAppPath 下的固定资产', () => {
    const root = createTemporaryRoot();
    const applicationDefault = createApplicationDefault(root);

    expect(resolveAppDefaultModelsPath({
      configuredPath: undefined,
      applicationPath: root,
      developmentRoot: path.join(root, 'ignored-development-root'),
      isPackaged: true,
    })).toEqual({ path: applicationDefault, source: 'application_default' });
  });

  it('开发环境使用仓库根，不把 Electron bundle 入口目录当成源码根', () => {
    const root = createTemporaryRoot();
    const applicationPath = path.join(root, 'dist', 'main');
    const sourcePath = path.join(
      root,
      'src',
      'domains',
      'model-catalog',
      'features',
      'default-catalog',
      'assets',
      'default_models.json',
    );
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, '{"models":[]}\n', 'utf8');

    expect(resolveAppDefaultModelsPath({
      configuredPath: undefined,
      applicationPath,
      developmentRoot: root,
      isPackaged: false,
    })).toEqual({
      path: sourcePath,
      source: 'source_development',
    });
  });

  it('默认目录资产缺失时失败，不把不存在的候选路径传播给后端', () => {
    const root = createTemporaryRoot();
    expect(() => resolveAppDefaultModelsPath({
      configuredPath: undefined,
      applicationPath: root,
      developmentRoot: root,
      isPackaged: false,
    })).toThrow('开发源码缺少 Model Catalog 默认目录资产');
  });

  it('发布资产缺失时失败', () => {
    const root = createTemporaryRoot();
    expect(() => resolveAppDefaultModelsPath({
      configuredPath: undefined,
      applicationPath: root,
      developmentRoot: root,
      isPackaged: true,
    })).toThrow('发布包缺少 Model Catalog 默认目录资产');
  });
});
