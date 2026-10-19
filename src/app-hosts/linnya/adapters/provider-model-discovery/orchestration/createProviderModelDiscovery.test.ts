import type { ProviderModelDefinition } from '@linnya/provider-catalog';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createProviderModelDiscovery,
  ProviderModelDiscoveryError,
  type ProviderModelDiscoveryRequest,
} from '../index';

const request: ProviderModelDiscoveryRequest = {
  connectionId: 'deepseek',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-credential',
  bundledModels: [],
};

function deepSeekModel(id = 'deepseek-new') {
  return {
    id,
    name: 'DeepSeek New',
    context_window: 1_048_576,
    max_output_tokens: 393_216,
    input_modalities: ['text', 'image'],
    output_modalities: ['text'],
    effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' },
  };
}

function bundledModel(id: string): ProviderModelDefinition {
  return {
    id,
    display_name: `Bundled ${id}`,
    release_status: 'active',
    context_window_tokens: 262_144,
    max_input_tokens: 262_144,
    max_output_tokens: 32_768,
    capabilities: { image_input: false, tool_call: true, reasoning: false },
  };
}

function ollamaDetails(capabilities = ['completion', 'tools', 'vision', 'thinking']) {
  return {
    capabilities,
    model_info: { 'general.architecture': 'example', 'example.context_length': 1_048_576 },
  };
}

function modelsDevSource(ids: readonly string[]) {
  return {
    'ollama-cloud': {
      id: 'ollama-cloud',
      name: 'Ollama Cloud',
      npm: 'ai-sdk-ollama',
      models: Object.fromEntries(
        ids.map(id => [
          id,
          {
            id,
            name: `Remote ${id}`,
            tool_call: true,
            reasoning: false,
            modalities: { input: ['text'], output: ['text'] },
            limit: { context: 262_144, output: 65_536 },
          },
        ])
      ),
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('Provider model discovery', () => {
  it('DeepSeek 实时新 ID 不依赖 bundled，使用官方完整容量和视觉资料', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: [deepSeekModel()] }));
    const discovery = createProviderModelDiscovery({ fetchImplementation });

    expect(await discovery.discover(request)).toEqual([
      {
        status: 'available',
        definition: {
          id: 'deepseek-new',
          display_name: 'DeepSeek New',
          release_status: 'active',
          context_window_tokens: 1_048_576,
          max_input_tokens: 1_048_576,
          max_output_tokens: 393_216,
          capabilities: { image_input: true, tool_call: true, reasoning: true },
        },
      },
    ]);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe('https://api.example.com/v1/models');
    expect(new Headers(fetchImplementation.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer test-credential'
    );
  });

  it('新 ID 缺资料或不是文本输出时保持可见但不可激活，不猜容量', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [
          { id: 'unknown-model', name: 7 },
          { ...deepSeekModel('image-only'), output_modalities: ['image'] },
          { ...deepSeekModel('bad-capacity'), context_window: 100 },
        ],
      })
    );
    const result = await createProviderModelDiscovery({ fetchImplementation }).discover(request);
    expect(result).toEqual([
      {
        status: 'unavailable',
        id: 'unknown-model',
        display_name: 'unknown-model',
        reason: '供应商尚未提供完整模型资料',
      },
      {
        status: 'unavailable',
        id: 'image-only',
        display_name: 'DeepSeek New',
        reason: '该模型不支持文本对话',
      },
      {
        status: 'unavailable',
        id: 'bad-capacity',
        display_name: 'DeepSeek New',
        reason: '供应商报告的模型容量不一致',
      },
    ]);
  });

  it.each([
    { data: [deepSeekModel(), deepSeekModel()] },
    { data: [deepSeekModel(), { name: 'missing ID' }] },
    { models: [deepSeekModel()] },
  ])('非法列表整体失败，不返回已解析的半份快照', async payload => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    await expect(
      createProviderModelDiscovery({ fetchImplementation }).discover(request)
    ).rejects.toMatchObject({ name: 'ProviderModelDiscoveryError', statusCode: 502 });
  });

  it('Ollama 官方成员与详情优先，已知模型仅从精确 ID 的 bundled 补输出上限', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ models: [{ name: 'known-model' }] }))
      .mockResolvedValueOnce(Response.json(ollamaDetails()));
    const result = await createProviderModelDiscovery({ fetchImplementation }).discover({
      ...request,
      connectionId: 'ollama-cloud',
      baseUrl: 'https://ollama.example.com/',
      bundledModels: [bundledModel('known-model'), bundledModel('not-in-official-list')],
    });

    expect(result).toEqual([
      {
        status: 'available',
        definition: {
          ...bundledModel('known-model'),
          context_window_tokens: 1_048_576,
          max_input_tokens: 1_048_576,
          capabilities: { image_input: true, tool_call: true, reasoning: true },
        },
      },
    ]);
    expect(fetchImplementation.mock.calls.map(call => call[0])).toEqual([
      'https://ollama.example.com/api/tags',
      'https://ollama.example.com/api/show',
    ]);
    expect(fetchImplementation.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ model: 'known-model' })
    );
  });

  it('Ollama 真正新 ID 读取 models.dev 补资料，公共请求不携带供应商凭据', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ models: [{ name: 'new-model' }, { name: 'not-documented' }] })
      )
      .mockResolvedValueOnce(Response.json(ollamaDetails()))
      .mockResolvedValueOnce(Response.json(ollamaDetails()))
      .mockResolvedValueOnce(Response.json(modelsDevSource(['new-model', 'not-in-official-list'])));
    const result = await createProviderModelDiscovery({ fetchImplementation }).discover({
      ...request,
      connectionId: 'ollama-cloud',
    });

    expect(result).toEqual([
      {
        status: 'available',
        definition: expect.objectContaining({
          id: 'new-model',
          max_output_tokens: 65_536,
          context_window_tokens: 1_048_576,
          capabilities: { image_input: true, tool_call: true, reasoning: true },
        }),
      },
      {
        status: 'unavailable',
        id: 'not-documented',
        display_name: 'not-documented',
        reason: '尚无经过准入的最大输出容量资料',
      },
    ]);
    const metadataCall = fetchImplementation.mock.calls[3];
    expect(metadataCall?.[0]).toBe('https://models.dev/api.json');
    expect(new Headers(metadataCall?.[1]?.headers).has('authorization')).toBe(false);
  });

  it('Ollama 明确不支持对话/工具或未报告上下文时不借其他模型能力', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          models: [{ name: 'embedding' }, { name: 'chat-only' }, { name: 'unknown-context' }],
        })
      )
      .mockResolvedValueOnce(Response.json(ollamaDetails(['embedding'])))
      .mockResolvedValueOnce(Response.json(ollamaDetails(['completion'])))
      .mockResolvedValueOnce(
        Response.json({ capabilities: ['completion', 'tools'], model_info: {} })
      );
    const result = await createProviderModelDiscovery({ fetchImplementation }).discover({
      ...request,
      connectionId: 'ollama-cloud',
    });
    expect(result).toEqual([
      {
        status: 'unavailable',
        id: 'embedding',
        display_name: 'embedding',
        reason: '该模型不支持文本对话',
      },
      {
        status: 'unavailable',
        id: 'chat-only',
        display_name: 'chat-only',
        reason: '该模型不支持 Agent 所需的工具调用',
      },
      {
        status: 'unavailable',
        id: 'unknown-context',
        display_name: 'unknown-context',
        reason: '供应商尚未提供上下文容量',
      },
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
  });

  it('同批新模型触发公开资料读取时，不顺带覆盖已有模型的 bundled 输出合同', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ models: [{ name: 'known-model' }, { name: 'new-model' }] })
      )
      .mockResolvedValueOnce(Response.json(ollamaDetails()))
      .mockResolvedValueOnce(Response.json(ollamaDetails()))
      .mockResolvedValueOnce(Response.json(modelsDevSource(['known-model', 'new-model'])));
    const result = await createProviderModelDiscovery({ fetchImplementation }).discover({
      ...request,
      connectionId: 'ollama-cloud',
      bundledModels: [bundledModel('known-model')],
    });
    expect(result).toEqual([
      {
        status: 'available',
        definition: expect.objectContaining({
          id: 'known-model',
          display_name: 'Bundled known-model',
          max_output_tokens: 32_768,
        }),
      },
      {
        status: 'available',
        definition: expect.objectContaining({
          id: 'new-model',
          display_name: 'Remote new-model',
          max_output_tokens: 65_536,
        }),
      },
    ]);
  });

  it('Ollama 详情最多四个并发，完成顺序不同仍保持官方列表顺序', async () => {
    const ids = Array.from({ length: 9 }, (_, index) => `model-${index}`);
    let active = 0;
    let peak = 0;
    const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method !== 'POST') return Response.json({ models: ids.map(name => ({ name })) });
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active -= 1;
      return Response.json(ollamaDetails());
    });
    const result = await createProviderModelDiscovery({ fetchImplementation }).discover({
      ...request,
      connectionId: 'ollama-cloud',
      bundledModels: ids.map(bundledModel),
    });
    expect(peak).toBe(4);
    expect(
      result.map(model => (model.status === 'available' ? model.definition.id : model.id))
    ).toEqual(ids);
  });

  it('鉴权与网络异常不透传正文、地址或 secret', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('private response test-credential', { status: 401 }))
      .mockRejectedValueOnce(new Error('private https://api.example.com test-credential'));
    const discovery = createProviderModelDiscovery({ fetchImplementation });
    await expect(discovery.discover(request)).rejects.toMatchObject({
      message: '供应商拒绝模型列表查询，请检查连接凭据',
      statusCode: 401,
    });
    await expect(discovery.discover(request)).rejects.toMatchObject({
      message: '无法读取供应商模型资料，请重试',
      statusCode: 502,
    });
  });

  it('models.dev 失败不以 bundled 或空列表伪装刷新成功', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ models: [{ name: 'new-model' }] }))
      .mockResolvedValueOnce(Response.json(ollamaDetails()))
      .mockResolvedValueOnce(new Response('private upstream detail', { status: 503 }));
    await expect(
      createProviderModelDiscovery({ fetchImplementation }).discover({
        ...request,
        connectionId: 'ollama-cloud',
      })
    ).rejects.toMatchObject({ statusCode: 503, message: '模型资料查询失败（HTTP 503）' });
  });

  it('响应 headers 已返回但 body 未结束时仍执行超时', async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const fetchImplementation = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                'abort',
                () => controller.error(new Error('private body read error')),
                { once: true }
              );
            },
          })
        )
    );
    const operation = createProviderModelDiscovery({ fetchImplementation }).discover(request);
    const rejected = expect(operation).rejects.toMatchObject({
      statusCode: 504,
      message: '模型列表查询超时，请重试',
    });
    await Promise.resolve();
    timeout.abort();
    await rejected;
    expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000);
  });

  it('外部取消中止 HTTP 请求，不返回部分模型', async () => {
    const cancellation = new AbortController();
    const fetchImplementation = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('private abort detail')), {
            once: true,
          });
        })
    );
    const operation = createProviderModelDiscovery({ fetchImplementation }).discover({
      ...request,
      signal: cancellation.signal,
    });
    const rejected = expect(operation).rejects.toMatchObject({
      statusCode: 499,
      message: '模型列表刷新已取消',
    });
    cancellation.abort();
    await rejected;
  });

  it('列表协议显式注册，不将账号目录或本地 Ollama 送入 API-Key discovery', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const discovery = createProviderModelDiscovery({ fetchImplementation });
    expect(discovery.supports('deepseek')).toBe(true);
    expect(discovery.supports('ollama-cloud')).toBe(true);
    expect(discovery.supports('openai-api')).toBe(true);
    expect(discovery.supports('opencode-go')).toBe(true);
    expect(discovery.supports('anthropic')).toBe(true);
    for (const connectionId of ['ollama', 'openai-chatgpt-subscription', 'unknown']) {
      expect(discovery.supports(connectionId)).toBe(false);
      await expect(discovery.discover({ ...request, connectionId })).rejects.toBeInstanceOf(
        ProviderModelDiscoveryError
      );
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
