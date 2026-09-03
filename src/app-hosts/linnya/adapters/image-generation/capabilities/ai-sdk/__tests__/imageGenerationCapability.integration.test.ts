import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { generateImageWithAiSdk } from '../orchestration/generateImageWithAiSdk';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const RequestBodySchema = z
  .object({
    model: z.string(),
    prompt: z.string(),
    n: z.number(),
    size: z.string(),
    response_format: z.string(),
  })
  .passthrough();

describe('AI SDK image generation capability', () => {
  it('通过官方 compatible image model 发送 bearer/b64_json，并按 n 拆分已声明的调用', async () => {
    const bodies: unknown[] = [];
    const controlledFetch: typeof fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe('https://provider.example/v1/images/generations');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer image-secret');
      expect(headers.get('chatgpt-account-id')).toBe('upstream-account');
      expect(headers.get('originator')).toBe('linnya');
      if (typeof init?.body !== 'string') throw new Error('expected JSON request body');
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_BASE64 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await generateImageWithAiSdk(
      {
        providerId: 'volcengine',
        providerModelId: 'seedream-model',
        baseUrl: 'https://provider.example/v1',
        apiKey: 'image-secret',
        headers: {
          'chatgpt-account-id': 'upstream-account',
          originator: 'linnya',
        },
        responseFormat: 'b64_json',
        maxImagesPerCall: 1,
      },
      {
        modelId: 'catalog-image-model',
        prompt: '海边的风力发电机',
        size: '2K',
        count: 2,
      },
      { fetch: controlledFetch }
    );

    expect(controlledFetch).toHaveBeenCalledTimes(2);
    expect(bodies.map(body => RequestBodySchema.parse(body))).toEqual([
      {
        model: 'seedream-model',
        prompt: '海边的风力发电机',
        n: 1,
        size: '2K',
        response_format: 'b64_json',
      },
      {
        model: 'seedream-model',
        prompt: '海边的风力发电机',
        n: 1,
        size: '2K',
        response_format: 'b64_json',
      },
    ]);
    expect(result.images).toHaveLength(2);
    expect(result.images.every(image => image.bytes.byteLength > 0)).toBe(true);
  });

  it('Provider 失败时 maxRetries=0，只发出一次请求', async () => {
    const controlledFetch: typeof fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'sensitive provider body' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
    );
    await expect(
      generateImageWithAiSdk(
        {
          providerId: 'volcengine',
          providerModelId: 'seedream-model',
          baseUrl: 'https://provider.example/v1',
          apiKey: 'image-secret',
          responseFormat: 'b64_json',
          maxImagesPerCall: 1,
        },
        {
          modelId: 'catalog-image-model',
          prompt: '测试图片',
          size: '2048x2048',
          count: 1,
        },
        { fetch: controlledFetch }
      )
    ).rejects.toBeDefined();
    expect(controlledFetch).toHaveBeenCalledTimes(1);
  });

  it('按 ChatGPT 订阅路由调用 Codex backend 图片端点', async () => {
    const controlledFetch: typeof fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe('https://chatgpt.com/backend-api/codex/images/generations');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer oauth-access-token');
      expect(headers.get('chatgpt-account-id')).toBe('upstream-account');
      expect(headers.get('originator')).toBe('linnya');
      if (typeof init?.body !== 'string') throw new Error('expected JSON request body');
      expect(RequestBodySchema.parse(JSON.parse(init.body))).toEqual({
        model: 'gpt-image-2',
        prompt: '生成一张简洁的几何海报',
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
      });
      return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_BASE64 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await generateImageWithAiSdk(
      {
        providerId: 'chatgpt-subscription',
        providerModelId: 'gpt-image-2',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        apiKey: 'oauth-access-token',
        headers: {
          'chatgpt-account-id': 'upstream-account',
          originator: 'linnya',
        },
        responseFormat: 'b64_json',
        maxImagesPerCall: 1,
      },
      {
        modelId: 'chatgpt-subscription-gpt-image-2',
        prompt: '生成一张简洁的几何海报',
        size: '1024x1024',
        count: 1,
      },
      { fetch: controlledFetch }
    );

    expect(result.model).toBe('gpt-image-2');
    expect(result.images).toHaveLength(1);
  });
});
