import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDiscoveryUrl,
  parseModelListingResponse,
  ModelDiscoveryService,
} from '../modelDiscoveryService';

describe('ModelDiscoveryService', () => {
  it('正式列表身份查询不推断容量，也不消费响应中的容量默认值', async () => {
    const service = new ModelDiscoveryService({
      fetchFn: async () => Response.json({ data: [{ id: 'unknown' }, {
        id: 'gpt-5', context_window: 12345, max_output_tokens: 678,
      }] }),
    });
    expect(await service.listIdentities({
      api_format: 'openai_compatible', base_url: 'https://provider.example/v1',
    })).toEqual([{ id: 'unknown' }, { id: 'gpt-5' }]);
  });

  it('正式列表查询跟随外部取消，错误不包含上游私有细节', async () => {
    const cancellation = new AbortController();
    const service = new ModelDiscoveryService({
      fetchFn: async (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('private abort detail')), { once: true });
      }),
    });
    const pending = service.listIdentities({
      api_format: 'openai_compatible', base_url: 'https://provider.example/v1',
    }, cancellation.signal);
    const assertion = expect(pending).rejects.toMatchObject({ statusCode: 499, message: '模型列表刷新已取消' });
    cancellation.abort();
    await assertion;
  });

  describe('buildDiscoveryUrl', () => {
    it('builds /models for openai_compatible', () => {
      expect(buildDiscoveryUrl('https://api.openai.com/v1', 'openai_compatible')).toBe(
        'https://api.openai.com/v1/models'
      );
      expect(buildDiscoveryUrl('https://api.openai.com/v1/models', 'openai_compatible')).toBe(
        'https://api.openai.com/v1/models'
      );
    });

    it('builds /v1/models for anthropic_compatible', () => {
      expect(buildDiscoveryUrl('https://api.anthropic.com/v1', 'anthropic_compatible')).toBe(
        'https://api.anthropic.com/v1/models?limit=1000'
      );
      expect(buildDiscoveryUrl('https://api.anthropic.com', 'anthropic_compatible')).toBe(
        'https://api.anthropic.com/v1/models?limit=1000'
      );
    });
  });

  describe('parseModelListingResponse', () => {
    it('parses standard OpenAI format with inferred capabilities', () => {
      const data = {
        data: [
          { id: 'gpt-4o', created: 123456 },
          { id: 'deepseek-chat', created: 123456 },
        ],
      };
      const models = parseModelListingResponse(data);
      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        id: 'gpt-4o',
        name: 'gpt-4o',
        context_window_tokens: 128000,
        max_output_tokens: 4096,
        supports_image_input: true,
        confidence: 'inferred',
      });
      expect(models[1]).toMatchObject({
        id: 'deepseek-chat',
        name: 'deepseek-chat',
        context_window_tokens: 64000,
        supports_image_input: false,
        confidence: 'inferred',
      });
    });

    it('prefers reported capabilities when present', () => {
      const data = {
        data: [
          {
            id: 'custom-model',
            display_name: 'Custom Model',
            context_window: 256000,
            max_output_tokens: 16384,
            supports_image_input: true,
          },
        ],
      };
      const models = parseModelListingResponse(data);
      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'custom-model',
        name: 'Custom Model',
        context_window_tokens: 256000,
        max_output_tokens: 16384,
        supports_image_input: true,
        confidence: 'reported',
      });
    });

    it('parses enriched map format (OpenRouter style)', () => {
      const data = {
        models: {
          'meta-llama/llama-3.3-70b-instruct': {
            name: 'Llama 3.3 70B',
            context_length: 131072,
            top_provider: {
              max_completion_tokens: 8192,
            },
          },
        },
      };
      const models = parseModelListingResponse(data);
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('meta-llama/llama-3.3-70b-instruct');
      expect(models[0].name).toBe('Llama 3.3 70B');
      expect(models[0].context_window_tokens).toBe(131072);
      expect(models[0].max_output_tokens).toBe(8192);
      expect(models[0].confidence).toBe('reported');
    });
  });

  describe('ModelDiscoveryService discover', () => {
    it('handles network success and builds correct headers', async () => {
      let requestedUrl = '';
      let requestedHeaders = new Headers();

      const mockFetch: typeof fetch = async (url, init) => {
        requestedUrl = String(url);
        requestedHeaders = new Headers(init?.headers);
        return new Response(
          JSON.stringify({
            data: [{ id: 'gpt-4o' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const service = new ModelDiscoveryService({ fetchFn: mockFetch });
      const result = await service.discover({
        api_format: 'openai_compatible',
        base_url: 'https://api.openai.com/v1',
        api_key: 'sk-test',
      });

      expect(requestedUrl).toBe('https://api.openai.com/v1/models');
      expect(requestedHeaders.get('Authorization')).toBe('Bearer sk-test');
      expect(result.models).toHaveLength(1);
      expect(result.models[0].id).toBe('gpt-4o');
    });

    it('throws auth_failed on 401 response', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response('Unauthorized', { status: 401 });
      };

      const service = new ModelDiscoveryService({ fetchFn: mockFetch });
      await expect(
        service.discover({
          api_format: 'openai_compatible',
          base_url: 'https://api.openai.com/v1',
          api_key: 'invalid-key',
        })
      ).rejects.toMatchObject({
        code: 'model_discovery.auth_failed',
        statusCode: 401,
      });
    });
  });

  it('Anthropic 按 after_id 读完全部页，同一身份去重后才返回完整目录', async () => {
    const requests: { url: string; headers: Headers; signal: AbortSignal | null | undefined }[] = [];
    const service = new ModelDiscoveryService({
      fetchFn: async (url, init) => {
        requests.push({ url: String(url), headers: new Headers(init?.headers), signal: init?.signal });
        expect(init?.redirect).toBe('error');
        return new Response(JSON.stringify(requests.length === 1
          ? { data: [{ id: 'a' }, { id: 'b' }], has_more: true, last_id: 'b' }
          : { data: [{ id: 'b' }, { id: 'c' }], has_more: false, last_id: 'c' }
        ));
      },
    });

    const result = await service.discover({
      api_format: 'anthropic_compatible', base_url: 'https://relay.example/anthropic', api_key: 'test-key',
    });

    expect(result.models.map(model => model.id)).toEqual(['a', 'b', 'c']);
    expect(requests.map(request => request.url)).toEqual([
      'https://relay.example/anthropic/models?limit=1000',
      'https://relay.example/anthropic/models?limit=1000&after_id=b',
    ]);
    for (const request of requests) {
      expect(request.headers.get('x-api-key')).toBe('test-key');
      expect(request.headers.get('anthropic-version')).toBe('2023-06-01');
      expect(request.signal).toBe(requests[0]?.signal);
    }
  });

  it('合法空末页结束发现，保留前页结果', async () => {
    let calls = 0;
    const service = new ModelDiscoveryService({
      fetchFn: async () => new Response(JSON.stringify(++calls === 1
        ? { data: [{ id: 'a' }], has_more: true, last_id: 'a' }
        : { data: [], has_more: false, last_id: null }
      )),
    });
    const result = await service.discover({
      api_format: 'anthropic_compatible', base_url: 'https://relay.example/v1',
    });
    expect(calls).toBe(2);
    expect(result.models.map(model => model.id)).toEqual(['a']);
  });

  it('明确完成的空列表返回空快照，区别于分页错误', async () => {
    const service = new ModelDiscoveryService({
      fetchFn: async () => new Response(JSON.stringify({
        data: [], has_more: false, last_id: null,
      })),
    });
    await expect(service.discover({
      api_format: 'anthropic_compatible', base_url: 'https://relay.example/v1',
    })).resolves.toEqual({ models: [] });
  });

  it.each([
    { name: '后页失败', body: { error: 'secret response' }, status: 503 },
    { name: '循环游标', body: { data: [{ id: 'b' }], has_more: true, last_id: 'a' }, status: 200 },
    { name: '空非末页', body: { data: [], has_more: true, last_id: 'b' }, status: 200 },
    { name: '缺少终止标记', body: { data: [{ id: 'b' }] }, status: 200 },
    { name: '未知格式', body: { unknown: [] }, status: 200 },
    { name: '非法分页标记', body: { data: [{ id: 'b' }], has_more: 'false' }, status: 200 },
    { name: '缺少续页游标', body: { data: [{ id: 'b' }], has_more: true }, status: 200 },
  ])('$name 不得把已经取得的部分模型作为完整目录返回', async ({ body, status }) => {
    let calls = 0;
    const service = new ModelDiscoveryService({
      fetchFn: async () => ++calls === 1
        ? new Response(JSON.stringify({ data: [{ id: 'a' }], has_more: true, last_id: 'a' }))
        : new Response(JSON.stringify(body), { status }),
    });
    await expect(service.discover({
      api_format: 'anthropic_compatible', base_url: 'https://relay.example/v1',
    })).rejects.toMatchObject({ code: 'model_discovery.failed' });
    expect(calls).toBe(2);
  });

  it('OpenAI 兼容端点显式声明未完分页时拒绝不完整快照，不猜测 cursor 参数', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: [{ id: 'a' }], has_more: true, last_id: 'a',
    })));
    await expect(new ModelDiscoveryService({ fetchFn }).discover({
      api_format: 'openai_compatible', base_url: 'https://relay.example/v1',
    })).rejects.toMatchObject({ code: 'model_discovery.unsupported_protocol', statusCode: 502 });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it.each([
    { api_format: 'openai_compatible' as const, body: { data: [{ id: 'a' }] } },
    { api_format: 'anthropic_compatible' as const, body: { data: [{ id: 'a' }] } },
    { api_format: 'openai_compatible' as const, body: { models: [{ id: 'a' }] } },
    { api_format: 'openai_compatible' as const, body: { models: { a: { name: 'A' } } } },
  ])('保留无分页声明的兼容列表 $api_format', async ({ api_format, body }) => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
    const result = await new ModelDiscoveryService({ fetchFn }).discover({
      api_format, base_url: 'https://relay.example/v1',
    });
    expect(result.models.map(model => model.id)).toEqual(['a']);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('所有分页共用 15 秒总期限，后页响应体超时不发布前页结果', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const service = new ModelDiscoveryService({
      fetchFn: async (_url, init) => {
        calls += 1;
        if (calls === 1) {
          await new Promise<void>(resolve => setTimeout(resolve, 8_000));
          return new Response(JSON.stringify({ data: [{ id: 'a' }], has_more: true, last_id: 'a' }));
        }
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(new Error('secret')));
          },
        }));
      },
    });
    const pending = service.discover({
      api_format: 'anthropic_compatible', base_url: 'https://relay.example/v1',
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'model_discovery.network_error', statusCode: 504, message: '请求模型列表超时（15s）',
    });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(7_000);
    await assertion;
  });

  afterEach(() => vi.useRealTimers());

  it('保留 Anthropic 网关显式前缀并拒绝带凭据或查询参数的 base URL', () => {
    expect(buildDiscoveryUrl('https://relay.example/anthropic', 'anthropic_compatible')).toBe(
      'https://relay.example/anthropic/models?limit=1000'
    );
    expect(() =>
      buildDiscoveryUrl('https://user:secret@relay.example/v1', 'openai_compatible')
    ).toThrow('API 地址无效');
    expect(() =>
      buildDiscoveryUrl('https://relay.example/v1?api_key=secret', 'openai_compatible')
    ).toThrow('API 地址无效');
  });

  it('错误 envelope 和非法模型不能被当成空列表成功，重复 ID 只产生一个选择项', () => {
    expect(() => parseModelListingResponse({ error: 'unauthorized' })).toThrow('格式无效');
    expect(() => parseModelListingResponse({ data: [{}] })).toThrow('格式无效');
    expect(parseModelListingResponse({ data: [{ id: 'a' }, { id: 'a' }] })).toHaveLength(1);
    expect(parseModelListingResponse({ data: [] })).toEqual([]);
  });

  it('响应体卡住也会超时，且不把密钥或原始异常带回界面', async () => {
    vi.useFakeTimers();
    const service = new ModelDiscoveryService({
      fetchFn: async (_url, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener('abort', () =>
              controller.error(new Error('secret echoed'))
            );
          },
        });
        expect(init?.redirect).toBe('error');
        return new Response(body);
      },
    });
    const pending = service.discover({
      api_format: 'anthropic_compatible',
      base_url: 'https://relay.example/v1',
      api_key: 'test-secret',
    });
    const assertion = expect(pending).rejects.toMatchObject({
      statusCode: 504,
      message: '请求模型列表超时（15s）',
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    const failing = new ModelDiscoveryService({
      fetchFn: async () => new Response('api_key=test-secret', { status: 503 }),
    });
    await expect(
      failing.discover({ api_format: 'openai_compatible', base_url: 'https://relay.example/v1' })
    ).rejects.toMatchObject({ message: '获取模型列表失败 (503)' });
  });
});
