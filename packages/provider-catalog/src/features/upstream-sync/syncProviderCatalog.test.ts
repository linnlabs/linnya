import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import publicCatalog from '../../generated/provider-catalog.generated.json';
import runtimeBindings from '../../generated/provider-runtime-bindings.generated.json';

const fileSystem = vi.hoisted(() => ({
  readFile: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => fileSystem);

import { syncProviderCatalog } from './syncProviderCatalog';

describe('syncProviderCatalog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const operation of Object.values(fileSystem)) operation.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('源摘要和策略均未变化时不解析或重写生成资产', async () => {
    const rawSource = 'same-source-does-not-need-to-be-parsed';
    const sourceSha256 = createHash('sha256').update(rawSource).digest('hex');
    const unchangedPublicCatalog = {
      ...publicCatalog,
      generation: {
        ...publicCatalog.generation,
        source_sha256: sourceSha256,
      },
    };
    const unchangedRuntimeBindings = {
      ...runtimeBindings,
      source_sha256: sourceSha256,
    };
    fileSystem.readFile
      .mockResolvedValueOnce(JSON.stringify(unchangedPublicCatalog))
      .mockResolvedValueOnce(JSON.stringify(unchangedRuntimeBindings));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(rawSource, { status: 200 })));

    await expect(syncProviderCatalog({ mode: 'check' })).resolves.toBe(
      `Provider Catalog 检查通过: ${publicCatalog.generation.id}`
    );
    expect(fileSystem.writeFile).not.toHaveBeenCalled();
    expect(fileSystem.rename).not.toHaveBeenCalled();
  });

  it('上游响应不是合法 JSON 时在写盘前失败', async () => {
    fileSystem.readFile
      .mockResolvedValueOnce(JSON.stringify(publicCatalog))
      .mockResolvedValueOnce(JSON.stringify(runtimeBindings));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status: 200 })));

    await expect(syncProviderCatalog({ mode: 'write' })).rejects.toThrow(SyntaxError);
    expect(fileSystem.writeFile).not.toHaveBeenCalled();
    expect(fileSystem.rename).not.toHaveBeenCalled();
  });
});
