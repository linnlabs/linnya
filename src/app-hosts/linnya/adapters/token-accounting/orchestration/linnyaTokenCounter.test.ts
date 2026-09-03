import { describe, expect, it, vi } from 'vitest';
import type { ModelConfig, ModelInferenceRoute } from 'src/domains/model-catalog';
import { LinnyaTokenCounter } from './linnyaTokenCounter';

function model(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'host-claude',
    model_name: 'claude-sonnet-4-6',
    catalog_source: 'default',
    capabilities: ['chat'],
    ui_visibility: ['chat'],
    display_name: 'Host Claude',
    description: '',
    ...overrides,
  };
}

function anthropicRoute(authProfile: 'api_key' | 'bearer', baseUrl: string): ModelInferenceRoute {
  return {
    api_surface: 'anthropic_messages',
    capability_id: 'ai-sdk:anthropic-messages',
    endpoint_id: 'fixture',
    endpoint_model_id: 'claude-sonnet-4-6',
    base_url: baseUrl,
    auth_profile: authProfile,
    context_window_tokens: 200_000,
    max_output_tokens: 8_192,
    input_support: { user_image: true, tool_result_image: true },
    usage: { response_usage: 'provider_reported_optional' },
    continuation: { tool_replay: 'required' },
  };
}

function catalog(config: ModelConfig) {
  return {
    getModel: vi.fn((id: string) => (id === config.id ? config : undefined)),
  };
}

function credentialResolver(requestHeaders?: Readonly<Record<string, string>>) {
  return {
    resolve: vi.fn(async (request: { readonly auth_profile: 'api_key' | 'bearer' }) => ({
      profile: request.auth_profile,
      secret: 'sk-test',
      ...(requestHeaders ? { request_headers: requestHeaders } : {}),
    })),
  };
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('LinnyaTokenCounter', () => {
  it('按 TokenRoute.baseURL 调用 Anthropic count endpoint，不根据模型名绕去官网', async () => {
    const config = model({
      inference_route: anthropicRoute('bearer', 'https://api.linnyai.com/proxy/anthropic'),
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => okJson({ input_tokens: 42 }));
    const counter = new LinnyaTokenCounter({
      catalog: catalog(config),
      credentialResolver: credentialResolver({ 'X-Device-ID': 'device-1' }),
      fetchImpl,
    });

    const result = await counter.countMessages({
      route: {
        capabilityId: 'token-count:anthropic-messages',
        baseURL: 'https://api.linnyai.com/proxy/anthropic',
        modelId: 'host-claude',
        endpointModelId: 'claude-sonnet-4-6',
        capabilities: {
          supportsRemoteTokenCount: true,
        },
      },
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.inputTokens).toBe(42);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://api.linnyai.com/proxy/anthropic/messages/count_tokens'
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer sk-test',
        'X-Device-ID': 'device-1',
      }),
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'claude-sonnet-4-6',
    });
  });

  it('route 未声明 supportsRemoteTokenCount 时拒绝调用', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okJson({ input_tokens: 1 }));
    const counter = new LinnyaTokenCounter({
      catalog: catalog(model()),
      credentialResolver: credentialResolver(),
      fetchImpl,
    });

    await expect(
      counter.countMessages({
        route: {
          capabilityId: 'token-count:anthropic-messages',
          baseURL: 'https://api.linnyai.com/proxy/anthropic',
          modelId: 'host-claude',
        },
        messages: [{ role: 'user', content: 'hello' }],
      })
    ).rejects.toThrow(/supportsRemoteTokenCount/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('远程计数 route 缺少 baseURL 时明确失败，不从模型目录猜地址', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okJson({ input_tokens: 1 }));
    const counter = new LinnyaTokenCounter({
      catalog: catalog(model()),
      credentialResolver: credentialResolver(),
      fetchImpl,
    });

    await expect(
      counter.countMessages({
        route: {
          capabilityId: 'token-count:anthropic-messages',
          modelId: 'host-claude',
          capabilities: { supportsRemoteTokenCount: true },
        },
        messages: [{ role: 'user', content: 'hello' }],
      })
    ).rejects.toThrow(/缺少 baseURL/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('按 capabilityId 选择 Z.AI tokenizer，并严格读取 usage.total_tokens', async () => {
    const config = model({
      id: 'glm-through-gateway',
      model_name: 'glm-4.6',
      catalog_source: 'default',
      inference_route: {
        ...anthropicRoute('bearer', 'https://api.z.ai/api'),
        api_surface: 'openai_chat_completions',
        capability_id: 'ai-sdk:openai-compatible',
        endpoint_model_id: 'glm-4.6',
      },
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => okJson({ usage: { total_tokens: 77 } }));
    const counter = new LinnyaTokenCounter({
      catalog: catalog(config),
      credentialResolver: credentialResolver(),
      fetchImpl,
    });

    const result = await counter.countMessages({
      route: {
        capabilityId: 'token-count:zai-tokenizer',
        baseURL: 'https://api.z.ai/api',
        modelId: 'glm-through-gateway',
        endpointModelId: 'glm-4.6',
        capabilities: {
          supportsRemoteTokenCount: true,
        },
      },
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.inputTokens).toBe(77);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.z.ai/api/paas/v4/tokenizer');
  });

  it('响应字段不符合当前 surface 时明确失败，不递归扫描其它 token 数字', async () => {
    const config = model({
      inference_route: anthropicRoute('api_key', 'https://api.anthropic.com/v1'),
    });
    const counter = new LinnyaTokenCounter({
      catalog: catalog(config),
      credentialResolver: credentialResolver(),
      fetchImpl: vi.fn<typeof fetch>(async () => okJson({ usage: { total_tokens: 42 } })),
    });

    await expect(
      counter.countMessages({
        route: {
          capabilityId: 'token-count:anthropic-messages',
          baseURL: 'https://api.anthropic.com/v1',
          modelId: config.id,
          capabilities: { supportsRemoteTokenCount: true },
        },
        messages: [{ role: 'user', content: 'hello' }],
      })
    ).rejects.toThrow(/input_tokens/);
  });
});
