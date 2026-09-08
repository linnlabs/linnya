import { describe, expect, it } from 'vitest';
import type { ModelConfig } from 'src/domains/model-catalog';
import { RerankingFailure } from 'src/domains/model-inference';
import { createInMemoryProviderOutboundDiagnostics } from 'src/domains/provider-diagnostics/features/provider-outbound';
import { createRerankingPort, type RerankingModelCatalog } from './createRerankingPort';

function model(): ModelConfig {
  return {
    id: 'reranking-model',
    model_name: 'provider-reranking-model',
    catalog_source: 'default',
    capabilities: ['rerank'],
    ui_visibility: ['rerank'],
    display_name: 'Reranking fixture',
    description: 'fixture',
    reranking_route: {
      api_surface: 'cohere_rerank',
      capability_id: 'ai-sdk:cohere-compatible-reranking',
      endpoint_id: 'fixture',
      endpoint_model_id: 'provider-reranking-model',
      base_url: 'https://fixture.invalid/v1',
      auth_profile: 'bearer',
      usage: { response_usage: 'provider_reported_optional' },
    },
  };
}

function catalog(config: ModelConfig | undefined = model()): RerankingModelCatalog {
  return {
    initialize: async () => undefined,
    getModel: () => config,
    resolveCredential: () => 'fixture-secret',
  };
}

describe('Reranking Host port', () => {
  it('只传递显式 route，并校验 Provider 返回索引', async () => {
    const outboundDiagnostics = createInMemoryProviderOutboundDiagnostics();
    const port = createRerankingPort({
      catalog: catalog(),
      outbound_diagnostics: outboundDiagnostics,
      invoke: async (route, request) => {
        expect(route).toEqual({
          providerModelId: 'provider-reranking-model',
          baseUrl: 'https://fixture.invalid/v1',
          apiKey: 'fixture-secret',
        });
        expect(request.documents).toEqual(['first', 'second']);
        return {
          ranking: [
            { originalIndex: 1, score: 0.9 },
            { originalIndex: 0, score: 0.9 },
          ],
          usage: { inputTokens: 5, raw: { provider_secret: 'RAW_USAGE_SECRET' } },
        };
      },
    });

    await expect(
      port.rerank({
        modelId: 'reranking-model',
        query: 'target',
        documents: ['first', 'second'],
      })
    ).resolves.toEqual({
      ranking: [
        { originalIndex: 0, score: 0.9 },
        { originalIndex: 1, score: 0.9 },
      ],
      usage: { inputTokens: 5, raw: { provider_secret: 'RAW_USAGE_SECRET' } },
    });

    expect(outboundDiagnostics.readLatest()).toMatchObject({
      operation: 'reranking',
      status: 'succeeded',
      input: { kind: 'reranking', document_count: 2 },
      usage: { provenance: 'provider_reported', input_tokens: 5 },
    });
    const serialized = JSON.stringify(outboundDiagnostics.readLatest());
    for (const sensitive of [
      'target',
      'first',
      'second',
      'fixture-secret',
      'fixture.invalid',
      'RAW_USAGE_SECRET',
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
  });

  it('拒绝 Provider 返回的重复索引', async () => {
    const port = createRerankingPort({
      catalog: catalog(),
      invoke: async () => ({
        ranking: [
          { originalIndex: 0, score: 0.9 },
          { originalIndex: 0, score: 0.8 },
        ],
      }),
    });

    await expect(
      port.rerank({
        modelId: 'reranking-model',
        query: 'target',
        documents: ['first'],
      })
    ).rejects.toMatchObject({ code: 'duplicate_document_index', retryable: false });
  });

  it('把 transport 错误投影为不泄露原始响应的稳定分类', async () => {
    const port = createRerankingPort({
      catalog: catalog(),
      invoke: async () => {
        throw new TypeError('sensitive transport detail');
      },
    });

    const failure = await port
      .rerank({
        modelId: 'reranking-model',
        query: 'secret query',
        documents: ['secret document'],
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RerankingFailure);
    expect(failure).toMatchObject({
      kind: 'transport',
      code: 'provider_transport_error',
      retryable: true,
      message: 'Reranking Provider 调用失败：provider_transport_error',
    });
    expect(String(failure)).not.toContain('sensitive');
  });

  it('由请求 signal 决定 aborted 分类', async () => {
    const controller = new AbortController();
    controller.abort('user_cancelled');
    const port = createRerankingPort({
      catalog: catalog(),
      invoke: async () => {
        throw new Error('raw abort detail');
      },
    });

    await expect(
      port.rerank({
        modelId: 'reranking-model',
        query: 'target',
        documents: ['first'],
        signal: controller.signal,
      })
    ).rejects.toMatchObject({
      kind: 'aborted',
      code: 'request_aborted',
      retryable: false,
    });
  });
});
