import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDiscoveryUrl,
  parseModelListingResponse,
  ModelDiscoveryService,
} from '../modelDiscoveryService';

describe('ModelDiscoveryService', () => {
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
