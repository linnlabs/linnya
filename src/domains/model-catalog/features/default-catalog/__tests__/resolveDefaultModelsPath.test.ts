import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveDefaultModelsPath,
  resolveExplicitDefaultModelsPath,
} from '../functions/resolveDefaultModelsPath';

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const temporaryPath of temporaryPaths.splice(0)) {
    rmSync(temporaryPath, { recursive: true, force: true });
  }
});

describe('默认模型目录路径', () => {
  it('只接受已经存在的绝对文件', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'linnya-model-catalog-'));
    temporaryPaths.push(root);
    const filePath = path.join(root, 'models.json');
    writeFileSync(filePath, '{"models":[]}\n', 'utf8');

    expect(resolveExplicitDefaultModelsPath(filePath)).toBe(filePath);
    expect(() => resolveExplicitDefaultModelsPath('models.json')).toThrow('MODEL_REGISTRY_DEFAULTS_PATH');
    expect(() => resolveExplicitDefaultModelsPath(path.join(root, 'missing.json')))
      .toThrow('MODEL_REGISTRY_DEFAULTS_PATH');
  });

  it('运行时缺少冻结路径时直接失败，不搜索历史目录', () => {
    expect(() => resolveDefaultModelsPath(undefined)).toThrow('MODEL_REGISTRY_DEFAULTS_PATH');
  });
});
