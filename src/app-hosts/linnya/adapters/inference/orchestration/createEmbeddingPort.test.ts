import { describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from 'src/domains/model-catalog';
import { EmbeddingFailure } from 'src/domains/model-inference';
import { createInMemoryProviderOutboundDiagnostics } from 'src/domains/provider-diagnostics/features/provider-outbound';
import { resolveEmbeddingSpaceId } from '../functions/resolveEmbeddingSpaceId';
import { createEmbeddingPort, type EmbeddingModelCatalog } from './createEmbeddingPort';

function model(): ModelConfig {
  return {
    id: 'embedding-model',
    model_name: 'provider-embedding-model',
    catalog_source: 'default',
    capabilities: ['embedding'],
    ui_visibility: ['embedding'],
    display_name: 'Embedding fixture',
    description: 'fixture',
    embedding_route: {
      api_surface: 'openai_embeddings',
      capability_id: 'ai-sdk:openai-compatible-embeddings',
      endpoint_id: 'fixture',
      endpoint_model_id: 'provider-embedding-model',
      base_url: 'https://fixture.invalid/v1',
      auth_profile: 'bearer',
      usage: { response_usage: 'provider_reported_optional' },
    },
  };
}

function catalog(config: ModelConfig | undefined = model()): EmbeddingModelCatalog {
  return {
    initialize: async () => undefined,
    getModel: () => config,
    resolveCredential: () => 'fixture-secret',
  };
}

describe('Embedding Host port', () => {
  it('来源身份忽略显示名、凭据与本地ID，规范化实际请求URL；上游模型或地址变化可识别', async () => {
    const config = model();
    if (!config.embedding_route) throw new Error('fixture route missing');
    const identity = resolveEmbeddingSpaceId(config.embedding_route);
    const equivalent = {
      ...config.embedding_route,
      endpoint_id: 'replacement-local-endpoint',
      base_url: 'https://FIXTURE.invalid:443/v1/',
    };
    expect(resolveEmbeddingSpaceId(equivalent)).toBe(identity);
    expect(
      resolveEmbeddingSpaceId({ ...equivalent, endpoint_model_id: 'different-model' })
    ).not.toBe(identity);
    expect(
      resolveEmbeddingSpaceId({ ...equivalent, base_url: 'https://other.invalid/v1' })
    ).not.toBe(identity);
    config.display_name = 'Renamed';
    config.id = 'another-local-id';
    const port = createEmbeddingPort({
      catalog: { ...catalog(config), resolveCredential: () => 'replacement-secret' },
      invoke: async () => ({ vectors: [[1, 2]] }),
    });
    expect(
      (await port.embed({ modelId: config.id, values: ['one'], expectedSpaceId: identity })).spaceId
    ).toBe(identity);
    expect(identity).toMatch(/^embedding-space:v1:[a-f0-9]{64}$/);
  });

  it('即使向量维度可能相同，索引来源不匹配也在调用Provider前失败', async () => {
    const invoke = vi.fn(async () => ({ vectors: [[1, 2]] }));
    const port = createEmbeddingPort({ catalog: catalog(), invoke });
    await expect(
      port.embed({
        modelId: 'embedding-model',
        values: ['one'],
        expectedSpaceId: 'old-index-space',
      })
    ).rejects.toMatchObject({ code: 'embedding_space_mismatch', retryable: false });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('响应等待期间编辑目录，结果仍携带实际调用时冻结的来源', async () => {
    const config = model();
    if (!config.embedding_route) throw new Error('fixture route missing');
    const identity = resolveEmbeddingSpaceId(config.embedding_route);
    const port = createEmbeddingPort({
      catalog: catalog(config),
      invoke: async route => {
        expect(route.providerModelId).toBe('provider-embedding-model');
        if (!config.embedding_route) throw new Error('fixture route missing');
        config.embedding_route.endpoint_model_id = 'edited-during-call';
        await Promise.resolve();
        return { vectors: [[1, 2]] };
      },
    });
    expect((await port.embed({ modelId: config.id, values: ['one'] })).spaceId).toBe(identity);
    expect(resolveEmbeddingSpaceId(config.embedding_route)).not.toBe(identity);
  });

  it('只向 capability 传递显式 route，并校验返回向量', async () => {
    const outboundDiagnostics = createInMemoryProviderOutboundDiagnostics();
    const port = createEmbeddingPort({
      catalog: catalog(),
      outbound_diagnostics: outboundDiagnostics,
      invoke: async (route, request) => {
        expect(route).toEqual({
          providerId: 'fixture',
          providerModelId: 'provider-embedding-model',
          baseUrl: 'https://fixture.invalid/v1',
          apiKey: 'fixture-secret',
        });
        expect(request.values).toEqual(['first', 'second']);
        return {
          vectors: [
            [1, 2],
            [3, 4],
          ],
          usage: { inputTokens: 3, raw: [{ provider_secret: 'RAW_USAGE_SECRET' }] },
        };
      },
    });

    await expect(
      port.embed({
        modelId: 'embedding-model',
        values: ['first', 'second'],
      })
    ).resolves.toMatchObject({
      vectors: [
        [1, 2],
        [3, 4],
      ],
    });

    expect(outboundDiagnostics.readLatest()).toMatchObject({
      operation: 'embedding',
      status: 'succeeded',
      input: { kind: 'embedding', value_count: 2 },
      usage: { provenance: 'provider_reported', input_tokens: 3 },
    });
    const serialized = JSON.stringify(outboundDiagnostics.readLatest());
    for (const sensitive of [
      'first',
      'second',
      'fixture-secret',
      'fixture.invalid',
      'RAW_USAGE_SECRET',
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
  });

  it('把 transport 错误投影为稳定分类，不泄露原始错误', async () => {
    const port = createEmbeddingPort({
      catalog: catalog(),
      invoke: async () => {
        throw new TypeError('sensitive transport detail');
      },
    });

    const failure = await port
      .embed({ modelId: 'embedding-model', values: ['secret prompt'] })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EmbeddingFailure);
    expect(failure).toMatchObject({
      kind: 'transport',
      code: 'provider_transport_error',
      retryable: true,
      message: 'Embedding Provider 调用失败：provider_transport_error',
    });
    expect(String(failure)).not.toContain('sensitive');
  });

  it('由请求 signal 决定 aborted 分类', async () => {
    const controller = new AbortController();
    controller.abort('user_cancelled');
    const port = createEmbeddingPort({
      catalog: catalog(),
      invoke: async () => {
        throw new Error('raw abort detail');
      },
    });

    await expect(
      port.embed({
        modelId: 'embedding-model',
        values: ['only'],
        signal: controller.signal,
      })
    ).rejects.toMatchObject({
      kind: 'aborted',
      code: 'request_aborted',
      retryable: false,
    });
  });
});
