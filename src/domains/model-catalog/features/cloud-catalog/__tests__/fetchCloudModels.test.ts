/**
 * @file cloud-models.test.ts
 *
 * @description
 * 测试 fetchCloudModels() 对 Cloud 显式 inference route 的严格映射。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../functions/cloudModelIds', () => ({
  toCloudModelId: vi.fn((id: string) => `cloud:${id}`),
}));
vi.mock('src/shared/logger', () => ({
  Logger: vi.fn().mockImplementation(function MockLogger() {
    return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }),
}));

import { fetchCloudModels } from '../orchestration/fetchCloudModels';

/** 构造一个最小合法的云端模型 item */
function makeCloudItem(overrides: Record<string, unknown> = {}) {
  const base = {
    id: 'claude-3-5-sonnet',
    client_base_url: 'https://api.linnyai.com/proxy/anthropic',
    display_name: 'Claude 3.5 Sonnet',
    capabilities: ['chat'],
    client_inference_route: {
      api_surface: 'anthropic_messages',
      capability_id: 'ai-sdk:anthropic-messages',
      endpoint_id: 'linnya-cloud',
      endpoint_model_id: 'claude-3-5-sonnet',
      base_url: 'https://api.linnyai.com/proxy/anthropic',
      auth_profile: 'bearer',
      context_window_tokens: 200_000,
      max_output_tokens: 8_192,
      input_support: { user_image: true, tool_result_image: true },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'required' },
    },
    limits: { daily: 100, monthly: 1000 },
  };
  const merged = { ...base, ...overrides };
  if (!('client_inference_route' in overrides) && typeof merged.id === 'string') {
    merged.client_inference_route = {
      ...base.client_inference_route,
      endpoint_model_id: merged.id,
      endpoint_id: 'linnya-cloud',
      base_url: String(merged.client_base_url),
    };
  }
  return merged;
}

function mockFetchWith(items: unknown[], purposeDefaults: Record<string, string> = {}) {
  global.fetch = vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify({ models: items, task_defaults: purposeDefaults }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  );
}

describe('fetchCloudModels - 显式 inference route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Anthropic route 直接保留 AI SDK capability，不再生成旧 adapter 协议字段', async () => {
    mockFetchWith([makeCloudItem()]);

    const result = await fetchCloudModels();
    expect(result.success).toBe(true);
    expect(result.models).toHaveLength(1);

    const model = result.models[0];
    expect(model.inference_route?.capability_id).toBe('ai-sdk:anthropic-messages');
  });

  it('OpenAI surface 使用已注册 AI SDK capability', async () => {
    const item = makeCloudItem();
    mockFetchWith([
      {
        ...item,
        client_inference_route: {
          ...item.client_inference_route,
          api_surface: 'openai_chat_completions',
          capability_id: 'ai-sdk:openai-chat',
          input_support: { user_image: true, tool_result_image: false },
          continuation: { tool_replay: 'optional' },
        },
      },
    ]);

    const result = await fetchCloudModels();
    expect(result.success).toBe(true);

    const model = result.models[0];
    expect(model.inference_route?.capability_id).toBe('ai-sdk:openai-chat');
  });

  it('chat 模型缺少 inference route 时整批响应判为 invalid_payload', async () => {
    mockFetchWith([makeCloudItem({ client_inference_route: undefined })]);

    const result = await fetchCloudModels();
    expect(result).toMatchObject({ success: false, failureReason: 'invalid_payload' });
  });

  it('embedding 模型保留独立 route，不借用 chat route', async () => {
    mockFetchWith([
      makeCloudItem({
        id: 'embedding-model',
        client_base_url: 'https://api.linnyai.com/proxy/siliconflow',
        capabilities: ['embedding'],
        client_inference_route: undefined,
        client_embedding_route: {
          api_surface: 'openai_embeddings',
          capability_id: 'ai-sdk:openai-compatible-embeddings',
          endpoint_id: 'linnya-cloud',
          endpoint_model_id: 'embedding-model',
          base_url: 'https://api.linnyai.com/proxy/siliconflow',
          auth_profile: 'bearer',
          usage: { response_usage: 'provider_reported_optional' },
        },
      }),
    ]);

    const result = await fetchCloudModels();

    expect(result.success).toBe(true);
    expect(result.models[0].inference_route).toBeUndefined();
    expect(result.models[0].embedding_route?.capability_id).toBe(
      'ai-sdk:openai-compatible-embeddings'
    );
  });

  it('embedding 模型缺少 embedding route 时整批响应判为 invalid_payload', async () => {
    mockFetchWith([
      makeCloudItem({
        id: 'embedding-model',
        capabilities: ['embedding'],
        client_inference_route: undefined,
      }),
    ]);

    await expect(fetchCloudModels()).resolves.toMatchObject({
      success: false,
      failureReason: 'invalid_payload',
    });
  });

  it('rerank 模型保留独立 Cohere-compatible route', async () => {
    mockFetchWith([
      makeCloudItem({
        id: 'reranking-model',
        client_base_url: 'https://api.linnyai.com/proxy/siliconflow',
        capabilities: ['rerank'],
        client_inference_route: undefined,
        client_reranking_route: {
          api_surface: 'cohere_rerank',
          capability_id: 'ai-sdk:cohere-compatible-reranking',
          endpoint_id: 'linnya-cloud',
          endpoint_model_id: 'reranking-model',
          base_url: 'https://api.linnyai.com/proxy/siliconflow',
          auth_profile: 'bearer',
          usage: { response_usage: 'provider_reported_optional' },
        },
      }),
    ]);

    const result = await fetchCloudModels();

    expect(result.success).toBe(true);
    expect(result.models[0].inference_route).toBeUndefined();
    expect(result.models[0].reranking_route?.capability_id).toBe(
      'ai-sdk:cohere-compatible-reranking'
    );
  });

  it('rerank 模型缺少 reranking route 时整批响应判为 invalid_payload', async () => {
    mockFetchWith([
      makeCloudItem({
        id: 'reranking-model',
        capabilities: ['rerank'],
        client_inference_route: undefined,
      }),
    ]);

    await expect(fetchCloudModels()).resolves.toMatchObject({
      success: false,
      failureReason: 'invalid_payload',
    });
  });

  it('document OCR 模型保留独立 Host route', async () => {
    mockFetchWith([
      makeCloudItem({
        id: 'ocr-model',
        client_base_url: 'https://api.linnyai.com/proxy/paddleocr',
        capabilities: ['document_ocr'],
        client_inference_route: undefined,
        client_document_ocr_route: {
          api_surface: 'paddle_ocr_jobs',
          capability_id: 'host:paddle-ocr-jobs',
          endpoint_id: 'linnya-cloud',
          endpoint_model_id: 'ocr-model',
          base_url: 'https://api.linnyai.com/proxy/paddleocr',
          auth_profile: 'bearer',
          mode: 'document_upload',
          supports_abort_signal: true,
          attempt_timeout_ms: 300_000,
          poll_interval_ms: 5_000,
        },
      }),
    ]);

    const result = await fetchCloudModels();

    expect(result.success).toBe(true);
    expect(result.models[0].document_ocr_route?.capability_id).toBe('host:paddle-ocr-jobs');
  });

  it('document OCR 模型缺少 route 时整批响应判为 invalid_payload', async () => {
    mockFetchWith([
      makeCloudItem({
        id: 'ocr-model',
        capabilities: ['document_ocr'],
        client_inference_route: undefined,
      }),
    ]);

    await expect(fetchCloudModels()).resolves.toMatchObject({
      success: false,
      failureReason: 'invalid_payload',
    });
  });

  it('anthropic 模型只保留目录计费属性，不携带请求认证头', async () => {
    mockFetchWith([makeCloudItem()]);

    const result = await fetchCloudModels();
    const model = result.models[0];

    expect(model.billing_mode).toBe('cloud');
    expect(model).not.toHaveProperty('extra_headers');
  });

  it('应为 cloud 模型显式生成 token_route，避免按模型名猜 route', async () => {
    mockFetchWith([makeCloudItem({ id: 'claude-sonnet-4-6' })]);

    const result = await fetchCloudModels();
    const model = result.models[0];

    expect(model.token_route).toEqual({
      capabilityId: 'ai-sdk:anthropic-messages',
      baseURL: 'https://api.linnyai.com/proxy/anthropic',
      modelId: 'cloud:claude-sonnet-4-6',
      endpointModelId: 'claude-sonnet-4-6',
      capabilities: {
        supportsResponseUsage: true,
      },
    });
  });

  it('将云端 task_defaults 模型名转换为本地 cloud 模型 ID', async () => {
    mockFetchWith(
      [
        makeCloudItem({
          id: 'deepseek-v4-flash',
          client_base_url: 'https://api.linnyai.com/proxy/deepseek',
        }),
      ],
      {
        autocomplete: 'deepseek-v4-flash',
        knowledge_graph_extraction: 'gemini-3-flash-preview',
      }
    );

    const result = await fetchCloudModels();

    expect(result.success).toBe(true);
    expect(result.purposeDefaults).toEqual({
      autocomplete: 'cloud:deepseek-v4-flash',
      knowledge_graph_extraction: 'cloud:gemini-3-flash-preview',
    });
  });

  it('对结构不完整的云模型响应显式返回 invalid_payload', async () => {
    mockFetchWith([{ id: 'missing-client-route-and-limits' }]);

    const result = await fetchCloudModels();

    expect(result).toMatchObject({
      success: false,
      models: [],
      purposeDefaults: {},
      failureReason: 'invalid_payload',
    });
  });

  it('单条非法 KV 配置不会让其他 cloud 模型一起消失', async () => {
    mockFetchWith([
      makeCloudItem({ id: 'valid-search', capabilities: ['web_search'] }),
      { id: 'missing-client-route-and-limits' },
    ]);

    const result = await fetchCloudModels();

    expect(result.success).toBe(true);
    expect(result.models.map(model => model.model_name)).toEqual(['valid-search']);
  });

  it('未知扩展 capability 不会使整个 Cloud payload 失效', async () => {
    mockFetchWith([
      makeCloudItem({
        id: 'future-capability-model',
        capabilities: ['chat', 'image_input', 'vendor.future_input'],
      }),
    ]);

    const result = await fetchCloudModels();

    expect(result.success).toBe(true);
    expect(result.models[0]?.capabilities).toEqual(['chat', 'image_input', 'vendor.future_input']);
    expect(result.models[0]?.ui_visibility).toEqual(['chat', 'image_input', 'vendor.future_input']);
  });
});
