import { describe, expect, it, vi } from 'vitest';
import { rerankWithAiSdk } from '../orchestration/rerankWithAiSdk';

describe('AI SDK Reranking capability', () => {
  it('通过 Cohere-compatible codec 保留原文档索引和上游 raw usage', async () => {
    let requestUrl = '';
    let requestBody: unknown;
    let authorization: string | null = null;
    const fixtureFetch: typeof fetch = vi.fn(async (input, init) => {
      requestUrl = String(input);
      requestBody = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      authorization = new Headers(init?.headers).get('authorization');
      return Response.json({
        results: [
          { index: 1, relevance_score: 0.93 },
          { index: 0, relevance_score: 0.41 },
        ],
        meta: {
          billed_units: { search_units: 1 },
          tokens: { input_tokens: 17 },
          vendor_trace: 'trace-1',
        },
      });
    });

    const result = await rerankWithAiSdk(
      {
        providerModelId: 'fixture-reranker',
        baseUrl: 'https://fixture.invalid/v1',
        apiKey: 'fixture-secret',
      },
      {
        modelId: 'local-model-id',
        query: 'target',
        documents: ['first', 'second'],
        topN: 2,
      },
      { fetch: fixtureFetch },
    );

    expect(requestUrl).toBe('https://fixture.invalid/v1/rerank');
    expect(authorization).toBe('Bearer fixture-secret');
    expect(requestBody).toEqual({
      model: 'fixture-reranker',
      query: 'target',
      documents: ['first', 'second'],
      top_n: 2,
    });
    expect(result).toEqual({
      ranking: [
        { originalIndex: 1, score: 0.93 },
        { originalIndex: 0, score: 0.41 },
      ],
      usage: {
        inputTokens: 17,
        raw: {
          billed_units: { search_units: 1 },
          tokens: { input_tokens: 17 },
          vendor_trace: 'trace-1',
        },
      },
    });
  });

  it('maxRetries=0 时只发起一次失败请求', async () => {
    const fixtureFetch: typeof fetch = vi.fn(async () => Response.json(
      { message: 'upstream unavailable' },
      { status: 503 },
    ));

    await expect(rerankWithAiSdk(
      {
        providerModelId: 'fixture-reranker',
        baseUrl: 'https://fixture.invalid/v1',
        apiKey: 'fixture-secret',
      },
      { modelId: 'local-model-id', query: 'target', documents: ['first'] },
      { fetch: fixtureFetch },
    )).rejects.toThrow(/upstream unavailable/u);

    expect(fixtureFetch).toHaveBeenCalledTimes(1);
  });
});
