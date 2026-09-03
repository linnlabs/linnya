import { describe, expect, it, vi } from 'vitest';
import type { CanonicalInferenceEvent, CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import { consumeCanonicalInferenceStream } from '@linnlabs/linnkit/runtime-kernel';
import type { ModelConfig, ModelInferenceRoute } from 'src/domains/model-catalog';
import { createInMemoryProviderOutboundAudit } from 'src/domains/audit/features/provider-outbound-audit';
import type {
  InferenceCapability,
  InferenceCredentialResolver,
  InferenceModelCatalog,
} from '../definitions/inferenceCapability';
import { projectInferenceAttemptAudit } from '../functions/projectInferenceAttemptAudit';
import { createHostCanonicalInferencePort } from '../orchestration/createHostCanonicalInferencePort';
import { createInferenceCapabilityRegistry } from '../registry/createInferenceCapabilityRegistry';

const BASE_ROUTE: ModelInferenceRoute = {
  api_surface: 'mock',
  capability_id: 'host:mock',
  endpoint_id: 'synthetic',
  endpoint_model_id: 'synthetic-chat',
  base_url: 'mock://inference',
  auth_profile: 'none',
  context_window_tokens: 16_384,
  max_output_tokens: 2_048,
  input_support: { user_image: true, tool_result_image: false },
  usage: { response_usage: 'provider_reported_optional' },
  continuation: { tool_replay: 'optional' },
};

function makeModel(route: ModelInferenceRoute = BASE_ROUTE): ModelConfig {
  return {
    id: 'model-1',
    model_name: route.endpoint_model_id,
    catalog_source: 'default',
    capabilities: ['chat'],
    ui_visibility: ['chat'],
    display_name: 'Synthetic Chat',
    description: 'Synthetic inference fixture',
    inference_route: route,
  };
}

function makeRequest(): CanonicalInferenceRequest {
  return {
    model_id: 'model-1',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools: [],
    tool_choice: 'none',
    sampling: { max_output_tokens: 512 },
    invocation: { trace_id: 'trace-1', attempt_id: 'attempt-1' },
  };
}

function makeCatalog(model: ModelConfig = makeModel()): InferenceModelCatalog {
  return {
    getModel: modelId => (modelId === model.id ? model : undefined),
    getInferenceRouteProfileId: modelId => (modelId === model.id ? 'mock' : undefined),
  };
}

function makeCredentialResolver(): InferenceCredentialResolver {
  return {
    resolve: vi.fn(async request => ({ profile: request.auth_profile, secret: 'secret' })),
  };
}

function makeCapability(events: readonly CanonicalInferenceEvent[]): InferenceCapability {
  return {
    id: 'host:mock',
    api_surface: 'mock',
    async *stream() {
      yield* events;
    },
  };
}

describe('Host canonical inference orchestration', () => {
  it('按显式 route 选择唯一 capability，并交给 Linnkit 验证结构化终态', async () => {
    const capability = makeCapability([
      { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
      { type: 'answer_delta', text: 'hello' },
      {
        type: 'usage',
        usage: {
          inputTokens: 8,
          outputTokens: 1,
          source: 'provider-response-usage',
          confidence: 'actual',
        },
      },
      { type: 'finish', reason: 'stop' },
    ]);
    const credentialResolver = makeCredentialResolver();
    const port = createHostCanonicalInferencePort({
      model_catalog: makeCatalog(),
      capability_registry: createInferenceCapabilityRegistry([capability]),
      credential_resolver: credentialResolver,
      outbound_audit: createInMemoryProviderOutboundAudit(),
    });
    const observed: CanonicalInferenceEvent[] = [];

    await expect(
      consumeCanonicalInferenceStream(port.stream(makeRequest()), event => observed.push(event))
    ).resolves.toEqual({ type: 'finish', reason: 'stop' });
    expect(observed).toHaveLength(4);
    expect(credentialResolver.resolve).not.toHaveBeenCalled();
  });

  it('真实 Host attempt 写入安全终态和 Provider usage，不保存输入正文', async () => {
    const outboundAudit = createInMemoryProviderOutboundAudit();
    const capability = makeCapability([
      { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
      {
        type: 'usage',
        usage: {
          inputTokens: 8,
          outputTokens: 2,
          reasoningTokens: 1,
          totalTokens: 11,
          source: 'provider-response-usage',
          confidence: 'actual',
          rawUsage: { upstream_secret: 'PROVIDER_USAGE_SECRET' },
        },
      },
      { type: 'finish', reason: 'stop' },
    ]);
    const port = createHostCanonicalInferencePort({
      model_catalog: makeCatalog(),
      capability_registry: createInferenceCapabilityRegistry([capability]),
      credential_resolver: makeCredentialResolver(),
      outbound_audit: outboundAudit,
    });
    const request = {
      ...makeRequest(),
      messages: [
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'PROMPT_SECRET' }] },
      ],
    };

    await consumeCanonicalInferenceStream(port.stream(request), () => undefined);

    expect(outboundAudit.readLatest()).toMatchObject({
      status: 'succeeded',
      finish_reason: 'stop',
      usage: {
        provenance: 'provider_reported',
        input_tokens: 8,
        output_tokens: 2,
        reasoning_tokens: 1,
        total_tokens: 11,
      },
    });
    const serialized = JSON.stringify(outboundAudit.readLatest());
    expect(serialized).not.toContain('PROMPT_SECRET');
    expect(serialized).not.toContain('PROVIDER_USAGE_SECRET');
    expect(serialized).not.toContain('mock://inference');
  });

  it('capability 未注册时在凭据解析和 Provider invocation 前 fail-closed', async () => {
    const credentialResolver = makeCredentialResolver();
    const port = createHostCanonicalInferencePort({
      model_catalog: makeCatalog(),
      capability_registry: createInferenceCapabilityRegistry([]),
      credential_resolver: credentialResolver,
      outbound_audit: createInMemoryProviderOutboundAudit(),
    });

    await expect(async () => {
      for await (const _event of port.stream(makeRequest())) {
        // 缺 capability 时不应进入事件循环。
      }
    }).rejects.toMatchObject({ code: 'inference.capability_missing' });
    expect(credentialResolver.resolve).not.toHaveBeenCalled();
  });

  it('拒绝与 route 不一致的 capability surface', async () => {
    const capability = { ...makeCapability([]), api_surface: 'openai_chat_completions' as const };
    const port = createHostCanonicalInferencePort({
      model_catalog: makeCatalog(),
      capability_registry: createInferenceCapabilityRegistry([capability]),
      credential_resolver: makeCredentialResolver(),
      outbound_audit: createInMemoryProviderOutboundAudit(),
    });

    await expect(async () => {
      for await (const _event of port.stream(makeRequest())) {
        // surface 不一致时不应进入事件循环。
      }
    }).rejects.toMatchObject({ code: 'inference.capability_route_mismatch' });
  });

  it('拒绝 capability 伪造 start identity 与 continuation producer route', async () => {
    const events: CanonicalInferenceEvent[] = [
      { type: 'start', model_id: 'another-model', attempt_id: 'attempt-1' },
      { type: 'finish', reason: 'stop' },
    ];
    const port = createHostCanonicalInferencePort({
      model_catalog: makeCatalog(),
      capability_registry: createInferenceCapabilityRegistry([makeCapability(events)]),
      credential_resolver: makeCredentialResolver(),
      outbound_audit: createInMemoryProviderOutboundAudit(),
    });

    await expect(async () => {
      for await (const _event of port.stream(makeRequest())) {
        // route identity 错误时不发布事件。
      }
    }).rejects.toMatchObject({ code: 'inference.event_route_mismatch' });
  });

  it('route 声明 usage unavailable 时拒绝 actual usage 事件', async () => {
    const model = makeModel({
      ...BASE_ROUTE,
      usage: { response_usage: 'unavailable' },
    });
    const capability = makeCapability([
      { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
      {
        type: 'usage',
        usage: {
          inputTokens: 8,
          outputTokens: 1,
          source: 'provider-response-usage',
          confidence: 'actual',
        },
      },
    ]);
    const port = createHostCanonicalInferencePort({
      model_catalog: makeCatalog(model),
      capability_registry: createInferenceCapabilityRegistry([capability]),
      credential_resolver: makeCredentialResolver(),
      outbound_audit: createInMemoryProviderOutboundAudit(),
    });

    await expect(async () => {
      for await (const _event of port.stream(makeRequest())) {
        // usage capability 与事件不一致时中止。
      }
    }).rejects.toMatchObject({ code: 'inference.usage_unavailable' });
  });

  it.each([
    {
      name: '输出 token 超过 route 上限',
      request: { ...makeRequest(), sampling: { max_output_tokens: 4_096 } },
      code: 'inference.output_limit_exceeded',
    },
    {
      name: '指定了本轮未注册的工具',
      request: {
        ...makeRequest(),
        tool_choice: { type: 'tool' as const, name: 'missing_tool' },
      },
      code: 'inference.tool_choice_unknown',
    },
    {
      name: 'route 不支持工具结果图片',
      request: {
        ...makeRequest(),
        messages: [
          {
            role: 'tool' as const,
            tool_call_id: 'call-1',
            content: [
              {
                type: 'image' as const,
                media_type: 'image/png' as const,
                bytes: new Uint8Array([1]),
              },
            ],
          },
        ],
      },
      code: 'inference.image_placement_unsupported',
    },
  ])('在 capability invocation 前拒绝 $name', async ({ request, code }) => {
    const stream = vi.fn(makeCapability([]).stream);
    const capability: InferenceCapability = {
      id: 'host:mock',
      api_surface: 'mock',
      stream,
    };
    const port = createHostCanonicalInferencePort({
      model_catalog: makeCatalog(),
      capability_registry: createInferenceCapabilityRegistry([capability]),
      credential_resolver: makeCredentialResolver(),
      outbound_audit: createInMemoryProviderOutboundAudit(),
    });

    await expect(async () => {
      for await (const _event of port.stream(request)) {
        // admission 失败时不应进入事件循环。
      }
    }).rejects.toMatchObject({ code });
    expect(stream).not.toHaveBeenCalled();
  });

  it('认证 route 只向被选中的 capability 传递匹配 credential', async () => {
    const route: ModelInferenceRoute = {
      ...BASE_ROUTE,
      auth_profile: 'bearer',
    };
    const stream = vi.fn(
      makeCapability([
        { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
        { type: 'finish', reason: 'stop' },
      ]).stream
    );
    const credentialResolver = makeCredentialResolver();
    credentialResolver.resolve = vi.fn(async request => ({
      profile: request.auth_profile,
      secret: 'secret',
      request_headers: { 'X-Device-ID': 'device-fixture' },
    }));
    const port = createHostCanonicalInferencePort({
      model_catalog: makeCatalog(makeModel(route)),
      capability_registry: createInferenceCapabilityRegistry([
        { id: 'host:mock', api_surface: 'mock', stream },
      ]),
      credential_resolver: credentialResolver,
      outbound_audit: createInMemoryProviderOutboundAudit(),
    });

    await consumeCanonicalInferenceStream(port.stream(makeRequest()), () => undefined);

    expect(credentialResolver.resolve).toHaveBeenCalledWith({
      model_id: 'model-1',
      endpoint_id: 'synthetic',
      auth_profile: 'bearer',
    });
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        route: expect.objectContaining({ headers: { 'X-Device-ID': 'device-fixture' } }),
        credential: {
          profile: 'bearer',
          secret: 'secret',
          request_headers: { 'X-Device-ID': 'device-fixture' },
        },
      })
    );
  });

  it('只在 ChatGPT Codex Responses route 合并协议头与账号身份头', async () => {
    const route: ModelInferenceRoute = {
      ...BASE_ROUTE,
      api_surface: 'openai_responses',
      capability_id: 'ai-sdk:openai-responses',
      endpoint_id: 'chatgpt-subscription',
      endpoint_model_id: 'gpt-5.6',
      base_url: 'https://chatgpt.com/backend-api/codex',
      auth_profile: 'bearer',
      input_support: { user_image: true, tool_result_image: true },
      continuation: { tool_replay: 'required' },
    };
    const stream = vi.fn(
      makeCapability([
        { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
        { type: 'finish', reason: 'stop' },
      ]).stream
    );
    const credentialResolver = makeCredentialResolver();
    credentialResolver.resolve = vi.fn(async request => ({
      profile: request.auth_profile,
      secret: 'oauth-access-token',
      request_headers: {
        'chatgpt-account-id': 'upstream-account',
        originator: 'linnya',
      },
    }));
    const model = makeModel(route);
    const port = createHostCanonicalInferencePort({
      model_catalog: {
        getModel: modelId => (modelId === model.id ? model : undefined),
        getInferenceRouteProfileId: modelId =>
          modelId === model.id ? 'chatgpt_codex_responses' : undefined,
      },
      capability_registry: createInferenceCapabilityRegistry([
        { id: 'ai-sdk:openai-responses', api_surface: 'openai_responses', stream },
      ]),
      credential_resolver: credentialResolver,
      outbound_audit: createInMemoryProviderOutboundAudit(),
    });

    await consumeCanonicalInferenceStream(port.stream(makeRequest()), () => undefined);

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        route: expect.objectContaining({
          headers: {
            'chatgpt-account-id': 'upstream-account',
            originator: 'linnya',
            'OpenAI-Beta': 'responses=experimental',
          },
        }),
      })
    );
  });

  it('安全审计只投影计数与 route metadata，不包含正文、工具参数、图片 bytes 或 continuation', () => {
    const request: CanonicalInferenceRequest = {
      ...makeRequest(),
      messages: [
        { role: 'system', content: 'PROMPT_SECRET' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'USER_SECRET' },
            {
              type: 'image',
              media_type: 'image/png',
              bytes: new Uint8Array([83, 69, 67, 82, 69, 84]),
            },
          ],
        },
        {
          role: 'assistant',
          parts: [
            { type: 'text', text: 'ASSISTANT_SECRET' },
            {
              type: 'tool_call',
              call: { id: 'call-1', name: 'read_secret', arguments: { path: '/secret' } },
            },
          ],
        },
      ],
      tools: [
        {
          name: 'read_secret',
          description: 'TOOL_DESCRIPTION_SECRET',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: 'PATH_SECRET' } },
          },
        },
      ],
    };
    const projection = projectInferenceAttemptAudit(request, {
      model_id: 'model-1',
      route_profile_id: 'mock',
      ...BASE_ROUTE,
    });
    const serialized = JSON.stringify(projection);

    expect(projection.input).toMatchObject({
      message_count: 3,
      tool_count: 1,
      image_count: 1,
      image_media_types: ['image/png'],
    });
    for (const secret of [
      'PROMPT_SECRET',
      'USER_SECRET',
      'ASSISTANT_SECRET',
      'TOOL_DESCRIPTION_SECRET',
      'PATH_SECRET',
      '/secret',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
