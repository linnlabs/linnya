import { describe, expect, it } from 'vitest';

import type { InferenceEndpointView, ModelConfig } from 'src/domains/model-catalog';
import type { ProviderDefinition } from '@linnya/provider-catalog';

import { projectLegacyFormalProviderConfigurations } from './projectLegacyFormalProviderConfigurations';

const provider: ProviderDefinition = {
  id: 'openai',
  display_name: 'OpenAI',
  connections: [
    {
      id: 'openai-api',
      display_name: 'OpenAI API',
      kind: 'direct',
      release_status: 'stable',
      setup_fields: [],
      model_discovery: 'bundled',
      models: [
        {
          id: 'gpt-test',
          display_name: 'GPT Test',
          release_status: 'active',
          context_window_tokens: 256_000,
          max_input_tokens: 240_000,
          max_output_tokens: 16_000,
          capabilities: { image_input: true, tool_call: true, reasoning: true },
        },
      ],
    },
  ],
};

const ollamaProvider: ProviderDefinition = {
  id: 'ollama',
  display_name: 'Ollama',
  connections: [
    {
      id: 'ollama',
      display_name: 'Ollama 本地服务',
      kind: 'local_runtime',
      release_status: 'preview',
      setup_fields: [],
      model_discovery: 'local_runtime',
      models: [],
    },
  ],
};

const endpoint: InferenceEndpointView = {
  id: 'endpoint-1',
  route_profile_id: 'openai_responses',
  endpoint_id: 'openai:endpoint-1',
  base_url: 'https://api.openai.com/v1',
  auth_profile: 'bearer',
  credential_reference: {
    kind: 'stored_secret',
    credential_id: 'inference-endpoint:endpoint-1',
  },
  credential_status: 'configured',
};

function model(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'model-1',
    model_name: 'gpt-test',
    catalog_source: 'user',
    inference_endpoint_id: 'endpoint-1',
    capabilities: ['chat', 'image_input'],
    ui_visibility: [],
    display_name: 'GPT Test',
    description: 'legacy formal model',
    billing_mode: 'byok',
    inference_route: {
      api_surface: 'openai_responses',
      capability_id: 'ai-sdk:openai-responses',
      endpoint_id: 'openai:endpoint-1',
      endpoint_model_id: 'gpt-test',
      base_url: 'https://api.openai.com/v1',
      auth_profile: 'bearer',
      context_window_tokens: 256_000,
      max_output_tokens: 16_000,
      input_support: { user_image: true, tool_result_image: true },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    },
    ...overrides,
  };
}

const bindings = {
  get: (providerConnectionDefinitionId: string) =>
    providerConnectionDefinitionId === 'openai-api'
      ? {
          provider_definition_id: 'openai',
          provider_connection_definition_id: 'openai-api',
          endpoint_id: 'openai',
          default_base_url: 'https://api.openai.com/v1',
          auth_profile: 'bearer' as const,
          default_route_profile_id: 'openai_responses' as const,
        }
      : undefined,
};

describe('projectLegacyFormalProviderConfigurations', () => {
  it('把旧正式 onboarding 的精确 route/endpoint 身份迁移为 ConfiguredProvider', () => {
    const result = projectLegacyFormalProviderConfigurations({
      providers: [provider],
      bindings,
      models: [model()],
      endpoints: [endpoint],
      createId: () => 'configured-openai',
    });

    expect(result).toEqual({
      configuredProviders: [
        {
          id: 'configured-openai',
          provider_definition_id: 'openai',
          provider_connection_definition_id: 'openai-api',
          models: [{ provider_model_id: 'gpt-test', model_config_id: 'model-1' }],
        },
      ],
      skippedProviderIds: [],
    });
  });

  it('不因 URL 和模型名相同而认领自定义 API', () => {
    const customEndpoint = {
      ...endpoint,
      endpoint_id: 'custom-openai-responses:endpoint-1',
    };
    const originalRoute = model().inference_route;
    if (!originalRoute) throw new Error('测试模型缺少 inference route');
    const result = projectLegacyFormalProviderConfigurations({
      providers: [provider],
      bindings,
      models: [
        model({
          inference_route: {
            ...originalRoute,
            endpoint_id: customEndpoint.endpoint_id,
          },
        }),
      ],
      endpoints: [customEndpoint],
      createId: () => 'must-not-run',
    });

    expect(result.configuredProviders).toEqual([]);
  });

  it('同一 Provider 出现多个旧 endpoint 时保留数据但不猜归属', () => {
    const secondEndpoint: InferenceEndpointView = {
      ...endpoint,
      id: 'endpoint-2',
      endpoint_id: 'openai:endpoint-2',
      credential_reference: {
        kind: 'stored_secret',
        credential_id: 'inference-endpoint:endpoint-2',
      },
    };
    const originalRoute = model().inference_route;
    if (!originalRoute) throw new Error('测试模型缺少 inference route');
    const result = projectLegacyFormalProviderConfigurations({
      providers: [provider],
      bindings,
      models: [
        model(),
        model({
          id: 'model-2',
          inference_endpoint_id: 'endpoint-2',
          inference_route: {
            ...originalRoute,
            endpoint_id: 'openai:endpoint-2',
          },
        }),
      ],
      endpoints: [endpoint, secondEndpoint],
      createId: () => 'must-not-run',
    });

    expect(result).toEqual({ configuredProviders: [], skippedProviderIds: ['openai-api'] });
  });

  it('按旧 Ollama 固定 route 身份迁移 local_runtime Provider，不用 URL host 命名', () => {
    const ollamaEndpoint: InferenceEndpointView = {
      id: 'ollama-endpoint',
      route_profile_id: 'openai_compatible_chat',
      endpoint_id: 'ollama',
      base_url: 'http://localhost:11434/v1',
      auth_profile: 'none',
      credential_reference: { kind: 'none' },
      credential_status: 'not_required',
    };
    const result = projectLegacyFormalProviderConfigurations({
      providers: [ollamaProvider],
      bindings,
      models: [
        model({
          id: 'ollama-model',
          model_name: 'qwen3:8b',
          inference_endpoint_id: 'ollama-endpoint',
          inference_route: {
            api_surface: 'openai_chat_completions',
            capability_id: 'ai-sdk:openai-compatible',
            endpoint_id: 'ollama',
            endpoint_model_id: 'qwen3:8b',
            base_url: 'http://localhost:11434/v1',
            auth_profile: 'none',
            context_window_tokens: 32_768,
            max_output_tokens: 4_096,
            input_support: { user_image: false, tool_result_image: false },
            usage: { response_usage: 'provider_reported_optional' },
            continuation: { tool_replay: 'unavailable' },
          },
        }),
      ],
      endpoints: [ollamaEndpoint],
      createId: () => 'configured-ollama',
    });

    expect(result.configuredProviders).toEqual([
      {
        id: 'configured-ollama',
        provider_definition_id: 'ollama',
        provider_connection_definition_id: 'ollama',
        models: [{ provider_model_id: 'qwen3:8b', model_config_id: 'ollama-model' }],
      },
    ]);
  });
});
