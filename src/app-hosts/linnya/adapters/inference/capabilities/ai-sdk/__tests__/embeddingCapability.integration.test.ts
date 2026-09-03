import { describe, expect, it, vi } from 'vitest';
import { embedWithAiSdk } from '../orchestration/embedWithAiSdk';

describe('AI SDK Embedding capability', () => {
  it('通过 OpenAI-compatible 正式 codec 保持输入顺序并保留上游 raw usage', async () => {
    let requestUrl = '';
    let requestBody: unknown;
    let authorization: string | null = null;
    const fixtureFetch: typeof fetch = vi.fn(async (input, init) => {
      requestUrl = String(input);
      requestBody = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      authorization = new Headers(init?.headers).get('authorization');
      return Response.json({
        data: [
          { embedding: [0.1, 0.2] },
          { embedding: [0.3, 0.4] },
        ],
        usage: { prompt_tokens: 9, vendor_cache_tokens: 2 },
      });
    });

    const result = await embedWithAiSdk(
      {
        providerId: 'fixture-provider',
        providerModelId: 'fixture-embedding-model',
        baseUrl: 'https://fixture.invalid/v1',
        apiKey: 'fixture-secret',
      },
      {
        modelId: 'local-model-id',
        values: ['first', 'second'],
      },
      { fetch: fixtureFetch },
    );

    expect(requestUrl).toBe('https://fixture.invalid/v1/embeddings');
    expect(authorization).toBe('Bearer fixture-secret');
    expect(requestBody).toEqual({
      model: 'fixture-embedding-model',
      input: ['first', 'second'],
      encoding_format: 'float',
    });
    expect(result.vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(result.usage).toEqual({
      inputTokens: 9,
      raw: [{ prompt_tokens: 9, vendor_cache_tokens: 2 }],
    });
    expect(fixtureFetch).toHaveBeenCalledTimes(1);
  });

  it('maxRetries=0 时不替上层擅自重试失败请求', async () => {
    const fixtureFetch: typeof fetch = vi.fn(async () => Response.json(
      { error: { message: 'upstream unavailable', type: 'server_error' } },
      { status: 503 },
    ));

    await expect(embedWithAiSdk(
      {
        providerId: 'fixture-provider',
        providerModelId: 'fixture-embedding-model',
        baseUrl: 'https://fixture.invalid/v1',
        apiKey: 'fixture-secret',
      },
      { modelId: 'local-model-id', values: ['only'] },
      { fetch: fixtureFetch },
    )).rejects.toThrow(/upstream unavailable/u);

    expect(fixtureFetch).toHaveBeenCalledTimes(1);
  });

});
