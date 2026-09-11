import { describe, expect, it } from 'vitest';

import type { ModelConfig } from 'src/domains/model-catalog';
import { providerCatalog, type ProviderDefinition } from '@linnya/provider-catalog';
import type { ConfiguredProvider } from 'src/domains/provider-configuration';

import type { ComposeSelectableModelMenuInput } from '../definitions/modelPickerPorts';
import { composeSelectableModelMenu } from './composeSelectableModelMenu';

function providerDefinition(
  id: string,
  displayName: string,
  modelIds: readonly string[]
): ProviderDefinition {
  const connectionId = id === 'openai' ? 'openai-api' : id;
  return {
    id,
    display_name: displayName,
    connections: [
      {
        id: connectionId,
        display_name: `${displayName} API`,
        kind: 'direct',
        release_status: 'stable',
        setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
        model_discovery: 'bundled',
        models: modelIds.map(modelId => ({
          id: modelId,
          display_name: modelId.toUpperCase(),
          release_status: 'active',
          context_window_tokens: 256_000,
          max_input_tokens: 239_616,
          max_output_tokens: 16_384,
          capabilities: { image_input: true, tool_call: true, reasoning: true },
        })),
      },
    ],
  };
}

function chatModel(
  id: string,
  catalogSource: ModelConfig['catalog_source'],
  endpointId: string,
  displayName = id
): ModelConfig {
  return {
    id,
    model_name: id,
    catalog_source: catalogSource,
    ...(catalogSource === 'user' ? { inference_endpoint_id: endpointId } : {}),
    ...(catalogSource === 'cloud'
      ? {
          credential_reference: {
            kind: 'host_managed' as const,
            credential_id: 'linnya-cloud' as const,
          },
        }
      : {}),
    capabilities: ['chat'],
    ui_visibility: ['chat'],
    display_name: displayName,
    description: '',
    inference_route: {
      api_surface: 'openai_responses',
      capability_id: 'ai-sdk:openai-responses',
      endpoint_id: endpointId,
      endpoint_model_id: id,
      base_url: `https://${endpointId}.example.com/v1`,
      auth_profile: 'bearer',
      context_window_tokens: 256_000,
      max_output_tokens: 16_384,
      input_support: { user_image: true, tool_result_image: true },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'required' },
    },
    reasoning: {
      supported_efforts: ['low', 'medium', 'high'],
      default_effort: 'medium',
    },
  };
}

function configuredProvider(
  id: string,
  definitionId: string,
  modelIds: readonly string[]
): ConfiguredProvider {
  return {
    id,
    provider_definition_id: definitionId,
    provider_connection_definition_id: definitionId === 'openai' ? 'openai-api' : definitionId,
    models: modelIds.map(modelId => ({
      provider_model_id: modelId,
      model_config_id: `${definitionId}-${modelId}`,
    })),
  };
}

function input(
  overrides: Partial<ComposeSelectableModelMenuInput> = {}
): ComposeSelectableModelMenuInput {
  return {
    provider_definitions: [],
    configured_providers: [],
    models: [],
    inference_endpoints: [],
    provider_accounts: [],
    preferences: { provider_preferences: [], model_preferences: [] },
    has_credential: () => true,
    has_provider_account_credential: () => true,
    get_credential_status: () => 'available',
    get_provider_account_credential_status: () => 'available',
    ...overrides,
  };
}

describe('composeSelectableModelMenu', () => {
  it('按 route profile 把用户模型投影为可刷新 Custom API 分组', () => {
    const model = chatModel('company-gpt', 'user', 'custom-endpoint', 'Company GPT');
    model.custom_provider_name = 'Company Gateway';

    expect(composeSelectableModelMenu(input({ models: [model] })).custom_providers).toEqual([
      expect.objectContaining({
        provider_name: 'Company Gateway',
        api_format: 'openai_responses',
        base_url: 'https://custom-endpoint.example.com/v1',
        models: [expect.objectContaining({ model_config_id: 'company-gpt' })],
      }),
    ]);
  });

  it('把 ChatGPT 订阅生图模型归入 OpenAI Provider，而不是系统模型', () => {
    const definition = providerCatalog.get('openai');
    if (!definition) throw new Error('OpenAI 目录缺失');
    const result = composeSelectableModelMenu(
      input({
        provider_definitions: [definition],
        configured_providers: [
          {
            id: 'configured-chatgpt',
            provider_definition_id: 'openai',
            provider_connection_definition_id: 'openai-chatgpt-subscription',
            models: [],
          },
        ],
        provider_accounts: [
          {
            id: 'chatgpt-subscription',
            provider_connection_definition_id: 'openai-chatgpt-subscription',
            auth_method: 'oauth_pkce',
            created_at: '2026-08-31T00:00:00.000Z',
            updated_at: '2026-08-31T00:00:00.000Z',
          },
        ],
        models: [
          {
            id: 'chatgpt-image',
            model_name: 'gpt-image-2',
            catalog_source: 'account',
            credential_reference: {
              kind: 'provider_account',
              account_id: 'chatgpt-subscription',
            },
            capabilities: ['image_generation'],
            ui_visibility: ['image_generation'],
            display_name: 'GPT Image 2',
            description: '',
            image_generation_route: {
              api_surface: 'openai_images_generations',
              capability_id: 'ai-sdk:openai-compatible-image-generation',
              endpoint_id: 'chatgpt-subscription',
              endpoint_model_id: 'gpt-image-2',
              base_url: 'https://chatgpt.com/backend-api/codex',
              auth_profile: 'bearer',
              response_format: 'b64_json',
              max_images_per_call: 1,
            },
          },
        ],
      })
    );

    expect(result.cloud).toBeUndefined();
    expect(result.providers[0]?.models).toEqual([
      expect.objectContaining({
        materialized: true,
        model_config_id: 'chatgpt-image',
        capabilities: ['image_generation'],
        runtime_available: true,
      }),
    ]);
  });

  it('OpenCode Go 已连接后把 Kimi 等完整目录留在模型管理中', () => {
    const definition = providerCatalog.get('opencode-go');
    if (!definition) throw new Error('OpenCode Go 目录缺失');
    const result = composeSelectableModelMenu(
      input({
        provider_definitions: [definition],
        configured_providers: [
          {
            id: 'configured-opencode-go',
            provider_definition_id: 'opencode-go',
            provider_connection_definition_id: 'opencode-go',
            models: [{ provider_model_id: 'glm-5.3-flash', model_config_id: 'opencode-glm-flash' }],
          },
        ],
        models: [chatModel('opencode-glm-flash', 'user', 'opencode-endpoint')],
        inference_endpoints: [
          {
            id: 'opencode-endpoint',
            route_profile_id: 'openai_responses',
            endpoint_id: 'opencode-go',
            base_url: 'https://opencode.ai/zen/go/v1',
            auth_profile: 'bearer',
            credential_reference: { kind: 'stored_secret', credential_id: 'opencode-key' },
            credential_status: 'configured',
          },
        ],
      })
    );

    expect(
      result.providers[0]?.models.some(
        model => !model.materialized && model.provider_model_id === 'kimi-k3'
      )
    ).toBe(true);
  });

  it('按稳定 ConfiguredProvider 归属分组，不读取 URL 或模型名前缀猜 Provider', () => {
    const openai = configuredProvider('configured-openai', 'openai', ['gpt-a', 'gpt-b']);
    const anthropic = configuredProvider('configured-anthropic', 'anthropic', [
      'claude-a',
      'claude-b',
    ]);
    const result = composeSelectableModelMenu(
      input({
        provider_definitions: [
          providerDefinition('openai', 'OpenAI', ['gpt-a', 'gpt-b']),
          providerDefinition('anthropic', 'Anthropic', ['claude-a', 'claude-b']),
        ],
        configured_providers: [openai, anthropic],
        models: [
          chatModel('openai-gpt-a', 'user', 'endpoint-openai', 'GPT A'),
          chatModel('openai-gpt-b', 'user', 'endpoint-openai', 'GPT B'),
          chatModel('anthropic-claude-a', 'user', 'endpoint-anthropic', 'Claude A'),
          chatModel('anthropic-claude-b', 'user', 'endpoint-anthropic', 'Claude B'),
        ],
        inference_endpoints: [
          {
            id: 'endpoint-openai',
            route_profile_id: 'openai_responses',
            endpoint_id: 'openai',
            base_url: 'https://same-gateway.example.com/v1',
            auth_profile: 'bearer',
            credential_reference: { kind: 'stored_secret', credential_id: 'openai-key' },
            credential_status: 'configured',
          },
          {
            id: 'endpoint-anthropic',
            route_profile_id: 'anthropic_messages',
            endpoint_id: 'anthropic',
            base_url: 'https://same-gateway.example.com/v1',
            auth_profile: 'bearer',
            credential_reference: { kind: 'stored_secret', credential_id: 'anthropic-key' },
            credential_status: 'configured',
          },
        ],
      })
    );

    expect(result.providers.map(provider => provider.display_name)).toEqual([
      'OpenAI',
      'Anthropic',
    ]);
    expect(result.providers[0]?.models.map(model => model.display_name)).toEqual([
      'GPT A',
      'GPT B',
    ]);
    expect(result.providers[1]?.models.map(model => model.display_name)).toEqual([
      'Claude A',
      'Claude B',
    ]);
    expect(result.custom_models).toEqual([]);
  });

  it('Cloud 固定独立投影，自定义模型不生成 Provider，默认内置模型不冒充自定义', () => {
    const result = composeSelectableModelMenu(
      input({
        models: [
          chatModel('cloud-gpt', 'cloud', 'cloud', 'Cloud GPT'),
          chatModel('custom-intranet', 'user', 'custom-endpoint', '公司内网模型'),
          chatModel('legacy-default', 'default', 'legacy', '历史默认模型'),
        ],
        inference_endpoints: [
          {
            id: 'custom-endpoint',
            route_profile_id: 'openai_responses',
            endpoint_id: 'custom',
            base_url: 'http://intranet.local/v1',
            auth_profile: 'bearer',
            credential_reference: { kind: 'stored_secret', credential_id: 'custom-key' },
            credential_status: 'configured',
          },
        ],
      })
    );

    expect(result.cloud?.models.map(model => model.display_name)).toEqual(['Cloud GPT']);
    expect(result.custom_models.map(model => model.display_name)).toEqual(['公司内网模型']);
    expect(JSON.stringify(result)).not.toContain('历史默认模型');
  });

  it('目录新增一百个模型默认不进入快捷候选，仅作为未 materialize 设置事实', () => {
    const providerModelIds = [
      'gpt-active',
      ...Array.from({ length: 100 }, (_, index) => `gpt-new-${index}`),
    ];
    const provider = configuredProvider('configured-openai', 'openai', ['gpt-active']);
    const result = composeSelectableModelMenu(
      input({
        provider_definitions: [providerDefinition('openai', 'OpenAI', providerModelIds)],
        configured_providers: [provider],
        models: [chatModel('openai-gpt-active', 'user', 'endpoint-openai', 'GPT Active')],
        inference_endpoints: [
          {
            id: 'endpoint-openai',
            route_profile_id: 'openai_responses',
            endpoint_id: 'openai',
            base_url: 'https://api.openai.com/v1',
            auth_profile: 'bearer',
            credential_reference: { kind: 'stored_secret', credential_id: 'openai-key' },
            credential_status: 'configured',
          },
        ],
      })
    );

    const models = result.providers[0]?.models ?? [];
    expect(models).toHaveLength(101);
    expect(models.filter(model => model.materialized && model.picker_enabled)).toHaveLength(1);
    expect(models.filter(model => !model.materialized)).toHaveLength(100);
  });

  it('分别保留可见性偏好和 runtime availability，不用一个开关覆盖两种语义', () => {
    const provider = configuredProvider('configured-openai', 'openai', ['gpt-a']);
    const result = composeSelectableModelMenu(
      input({
        provider_definitions: [providerDefinition('openai', 'OpenAI', ['gpt-a'])],
        configured_providers: [provider],
        models: [chatModel('openai-gpt-a', 'user', 'endpoint-openai', 'GPT A')],
        inference_endpoints: [
          {
            id: 'endpoint-openai',
            route_profile_id: 'openai_responses',
            endpoint_id: 'openai',
            base_url: 'https://api.openai.com/v1',
            auth_profile: 'bearer',
            credential_reference: { kind: 'stored_secret', credential_id: 'openai-key' },
            credential_status: 'missing',
          },
        ],
        preferences: {
          provider_preferences: [{ configured_provider_id: 'configured-openai', visible: false }],
          model_preferences: [{ model_config_id: 'openai-gpt-a', visible: true }],
        },
      })
    );

    expect(result.providers[0]).toMatchObject({
      picker_enabled: false,
      credential_available: false,
      credential_unavailable_reason: 'missing',
      models: [{ picker_enabled: true, runtime_available: false }],
    });
  });

  it('把无需凭据的 Ollama local runtime 识别为可用正式 Provider', () => {
    const ollamaModel = chatModel('ollama-qwen', 'user', 'endpoint-ollama', 'Qwen Local');
    ollamaModel.inference_route = {
      api_surface: 'openai_chat_completions',
      capability_id: 'ai-sdk:openai-compatible',
      endpoint_id: 'ollama',
      endpoint_model_id: 'qwen3:8b',
      base_url: 'http://127.0.0.1:11434/v1',
      auth_profile: 'none',
      context_window_tokens: 256_000,
      max_output_tokens: 16_384,
      input_support: { user_image: true, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'required' },
    };
    const result = composeSelectableModelMenu(
      input({
        provider_definitions: [
          {
            id: 'ollama',
            display_name: 'Ollama',
            connections: [
              {
                id: 'ollama',
                display_name: 'Ollama 本地服务',
                kind: 'local_runtime',
                release_status: 'preview',
                setup_fields: [
                  {
                    id: 'service_url',
                    kind: 'url',
                    required: true,
                    label: '服务地址',
                    default_value: 'http://127.0.0.1:11434',
                  },
                ],
                model_discovery: 'local_runtime',
                models: [],
              },
            ],
          },
        ],
        configured_providers: [
          {
            id: 'configured-ollama',
            provider_definition_id: 'ollama',
            provider_connection_definition_id: 'ollama',
            models: [{ provider_model_id: 'qwen3:8b', model_config_id: 'ollama-qwen' }],
          },
        ],
        models: [ollamaModel],
        inference_endpoints: [
          {
            id: 'endpoint-ollama',
            route_profile_id: 'openai_compatible_chat',
            endpoint_id: 'ollama',
            base_url: 'http://127.0.0.1:11434/v1',
            auth_profile: 'none',
            credential_reference: { kind: 'none' },
            credential_status: 'not_required',
          },
        ],
        has_credential: () => false,
      })
    );

    expect(result.providers[0]).toMatchObject({
      display_name: 'Ollama',
      credential_available: true,
      models: [{ materialized: true, runtime_available: true }],
    });
  });

  it('账号退出后保留 ChatGPT 模型配置，但不再将其投影为可用 runtime', () => {
    const provider: ConfiguredProvider = {
      id: 'configured-chatgpt',
      provider_definition_id: 'openai',
      provider_connection_definition_id: 'openai-chatgpt-subscription',
      models: [
        {
          provider_model_id: 'gpt-5.6-sol',
          model_config_id: 'chatgpt-gpt-5.6-sol',
        },
      ],
    };
    const definition: ProviderDefinition = {
      id: 'openai',
      display_name: 'OpenAI',
      connections: [
        {
          id: 'openai-chatgpt-subscription',
          display_name: 'ChatGPT 订阅',
          kind: 'direct',
          release_status: 'preview',
          setup_fields: [
            {
              id: 'authorization',
              kind: 'oauth',
              required: true,
              label: '使用 ChatGPT 登录',
            },
          ],
          model_discovery: 'bundled',
          models:
            providerDefinition('chatgpt', 'ChatGPT', ['gpt-5.6-sol']).connections[0]?.models ?? [],
        },
      ],
    };
    const endpoint = {
      id: 'endpoint-chatgpt',
      route_profile_id: 'chatgpt_codex_responses' as const,
      endpoint_id: 'chatgpt',
      base_url: 'https://chatgpt.com/backend-api/codex',
      auth_profile: 'bearer' as const,
      credential_reference: {
        kind: 'provider_account' as const,
        account_id: 'chatgpt-subscription',
      },
      credential_status: 'configured' as const,
    };
    const commonInput = {
      provider_definitions: [definition],
      configured_providers: [provider],
      models: [chatModel('chatgpt-gpt-5.6-sol', 'user', 'endpoint-chatgpt', 'GPT-5.6 Sol')],
      inference_endpoints: [endpoint],
    };

    const loggedOut = composeSelectableModelMenu(
      input({
        ...commonInput,
        has_provider_account_credential: () => false,
      })
    );
    expect(loggedOut.providers[0]).toMatchObject({
      credential_available: false,
      models: [{ materialized: true, runtime_available: false }],
    });

    const reauthorized = composeSelectableModelMenu(
      input({
        ...commonInput,
        has_provider_account_credential: () => true,
      })
    );
    expect(reauthorized.providers[0]).toMatchObject({
      credential_available: true,
      models: [{ materialized: true, runtime_available: true }],
    });
  });
});
