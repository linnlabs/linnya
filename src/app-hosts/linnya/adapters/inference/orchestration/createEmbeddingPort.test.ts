import { describe, expect, it } from 'vitest';
import type { ModelConfig } from 'src/domains/model-catalog';
import { EmbeddingFailure } from 'src/domains/model-inference';
import { createInMemoryProviderOutboundAudit } from 'src/domains/audit/features/provider-outbound-audit';
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
  it('只向 capability 传递显式 route，并校验返回向量', async () => {
    const outboundAudit = createInMemoryProviderOutboundAudit();
    const port = createEmbeddingPort({
      catalog: catalog(),
      outbound_audit: outboundAudit,
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

    expect(outboundAudit.readLatest()).toMatchObject({
      operation: 'embedding',
      status: 'succeeded',
      input: { kind: 'embedding', value_count: 2 },
      usage: { provenance: 'provider_reported', input_tokens: 3 },
    });
    const serialized = JSON.stringify(outboundAudit.readLatest());
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
