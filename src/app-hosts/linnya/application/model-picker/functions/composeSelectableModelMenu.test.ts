import { describe, expect, it } from 'vitest';

import type { InferenceEndpointView, ModelConfig } from 'src/domains/model-catalog';
import { ModelPickerSnapshotSchema } from '@app/schemas/model-picker';
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

function customEndpoint(
  id: string,
  credentialStatus: InferenceEndpointView['credential_status'] = 'configured'
): InferenceEndpointView {
  return {
    id,
    route_profile_id: 'openai_responses',
    endpoint_id: id,
    base_url: `https://${id}.example.com/v1`,
    auth_profile: 'bearer',
    credential_reference: { kind: 'stored_secret', credential_id: `${id}-key` },
    credential_status: credentialStatus,
  };
}

function input(
  overrides: Partial<ComposeSelectableModelMenuInput> = {}
): ComposeSelectableModelMenuInput {
  return {
    discovered_models: { read: () => undefined },
    can_refresh_models: () => false,
    provider_definitions: [],
    configured_providers: [],
    models: [],
    unadmitted_models: [],
    inference_endpoints: [],
    custom_api_groups: [],
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

    expect(
      composeSelectableModelMenu(
        input({
          models: [model],
          custom_api_groups: [
            { name: 'Company Gateway', inference_endpoint_ids: ['custom-endpoint'] },
          ],
          inference_endpoints: [customEndpoint('custom-endpoint')],
        })
      ).custom_providers
    ).toEqual([
      expect.objectContaining({
        provider_name: 'Company Gateway',
        api_format: 'openai_responses',
        base_url: 'https://custom-endpoint.example.com/v1',
        models: [expect.objectContaining({ model_config_id: 'company-gpt' })],
      }),
    ]);
  });

  it('空自定义分组仍从已保存连接投影刷新和编辑身份，不伪造可用模型', () => {
    const result = ModelPickerSnapshotSchema.parse(
      composeSelectableModelMenu(
        input({
          custom_api_groups: [{ name: 'Relay', inference_endpoint_ids: ['relay'] }],
          inference_endpoints: [customEndpoint('relay', 'missing')],
        })
      )
    );

    expect(result.custom_providers).toEqual([
      {
        provider_id: 'custom:Relay',
        provider_name: 'Relay',
        api_format: 'openai_responses',
        base_url: 'https://relay.example.com/v1',
        endpoint_id: 'relay',
        models: [],
        unadmitted_models: [],
      },
    ]);
    expect(result.custom_models).toEqual([]);
  });

  it('自定义分组归属、快捷选择偏好和运行凭据可用性分别投影', () => {
    const usable = { ...chatModel('usable', 'user', 'ready'), custom_provider_name: 'Relay' };
    const unavailable = {
      ...chatModel('unavailable', 'user', 'missing'),
      custom_provider_name: 'Relay',
    };
    const result = composeSelectableModelMenu(
      input({
        models: [usable, unavailable],
        custom_api_groups: [{ name: 'Relay', inference_endpoint_ids: ['ready', 'missing'] }],
        inference_endpoints: [customEndpoint('ready'), customEndpoint('missing', 'missing')],
        preferences: {
          provider_preferences: [],
          model_preferences: [
            { model_config_id: usable.id, visible: false },
            { model_config_id: unavailable.id, visible: true },
          ],
        },
      })
    );

    expect(result.custom_providers?.[0]?.models).toEqual([
      expect.objectContaining({
        model_config_id: 'usable',
        picker_enabled: false,
        runtime_available: true,
      }),
      expect.objectContaining({
        model_config_id: 'unavailable',
        picker_enabled: true,
        runtime_available: false,
      }),
    ]);
  });

  it('Provider 目录未知也不把正式 membership 或未声明分组的模型转入自定义', () => {
    const formal = {
      ...chatModel('unknown-model', 'user', 'relay'),
      custom_provider_name: 'Relay',
    };
    const ungrouped = { ...chatModel('ungrouped', 'user', 'relay'), custom_provider_name: 'Other' };
    const result = composeSelectableModelMenu(
      input({
        models: [formal, ungrouped],
        custom_api_groups: [{ name: 'Relay', inference_endpoint_ids: ['relay'] }],
        inference_endpoints: [customEndpoint('relay')],
        configured_providers: [
          {
            id: 'configured-unknown',
            provider_definition_id: 'unknown',
            provider_connection_definition_id: 'unknown',
            models: [{ model_config_id: formal.id, provider_model_id: 'remote' }],
          },
        ],
      })
    );

    expect(result.custom_providers?.[0]?.models).toEqual([]);
    expect(result.custom_models).toEqual([]);
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

  it('排在归属第一位的模型启动时停用，Provider 凭据仍按其余成员判断，其余模型照常可选', () => {
    const result = composeSelectableModelMenu(
      input({
        provider_definitions: [providerDefinition('openai', 'OpenAI', ['gpt-a', 'gpt-b'])],
        configured_providers: [
          configuredProvider('configured-openai', 'openai', ['gpt-a', 'gpt-b']),
        ],
        // gpt-a 没有通过准入：归属还在，但它不在运行目录里。
        models: [chatModel('openai-gpt-b', 'user', 'endpoint-openai', 'GPT B')],
        inference_endpoints: [customEndpoint('endpoint-openai')],
      })
    );

    const [provider] = result.providers;
    expect(provider?.credential_available).toBe(true);
    expect(provider?.models.find(model => model.provider_model_id === 'gpt-b')).toMatchObject({
      materialized: true,
      runtime_available: true,
    });
  });

  it('停用的 Provider 成员只出现在“配置无效”里，不当作可启用候选；定义里还在的可修复', () => {
    const result = ModelPickerSnapshotSchema.parse(
      composeSelectableModelMenu(
        input({
          provider_definitions: [providerDefinition('openai', 'OpenAI', ['gpt-a', 'gpt-b'])],
          configured_providers: [
            {
              ...configuredProvider('configured-openai', 'openai', ['gpt-a', 'gpt-b']),
              // gpt-old 已从 Provider 定义下架，只能删除。
              models: [
                { provider_model_id: 'gpt-a', model_config_id: 'openai-gpt-a' },
                { provider_model_id: 'gpt-b', model_config_id: 'openai-gpt-b' },
                { provider_model_id: 'gpt-old', model_config_id: 'openai-gpt-old' },
              ],
            },
          ],
          models: [chatModel('openai-gpt-b', 'user', 'endpoint-openai', 'GPT B')],
          unadmitted_models: [
            {
              id: 'openai-gpt-a',
              inference_endpoint_id: 'endpoint-openai',
              custom_api_group_name: undefined,
              display_name: 'GPT A',
              reason: '用户模型 openai-gpt-a 的 route 与 InferenceEndpoint endpoint-openai 不一致',
              reason_kind: 'route_endpoint_mismatch',
            },
            {
              id: 'openai-gpt-old',
              inference_endpoint_id: 'endpoint-openai',
              custom_api_group_name: undefined,
              display_name: undefined,
              reason: '用户模型 openai-gpt-old 必须声明唯一的推理 route',
              reason_kind: 'multiple_routes',
            },
          ],
          inference_endpoints: [customEndpoint('endpoint-openai')],
        })
      )
    );

    const [provider] = result.providers;
    expect(provider?.models.map(model => model.provider_model_id)).toEqual(['gpt-b']);
    expect(provider?.unadmitted_models).toEqual([
      {
        model_config_id: 'openai-gpt-a',
        display_name: 'GPT A',
        reason_kind: 'route_endpoint_mismatch',
        reason: '用户模型 openai-gpt-a 的 route 与 InferenceEndpoint endpoint-openai 不一致',
        repairable: true,
      },
      {
        model_config_id: 'openai-gpt-old',
        display_name: 'gpt-old',
        reason_kind: 'multiple_routes',
        reason: '用户模型 openai-gpt-old 必须声明唯一的推理 route',
        repairable: false,
      },
    ]);
    expect(result.unassigned_unadmitted_models).toEqual([]);
  });

  it('Provider 只剩停用成员时凭据按它们引用的连接判断，不误报凭据缺失', () => {
    const unadmitted = (credentialStatus: InferenceEndpointView['credential_status']) =>
      composeSelectableModelMenu(
        input({
          provider_definitions: [providerDefinition('openai', 'OpenAI', ['gpt-a'])],
          configured_providers: [configuredProvider('configured-openai', 'openai', ['gpt-a'])],
          unadmitted_models: [
            {
              id: 'openai-gpt-a',
              inference_endpoint_id: 'endpoint-openai',
              custom_api_group_name: undefined,
              display_name: 'GPT A',
              reason: '用户模型 openai-gpt-a 的 route 与 InferenceEndpoint endpoint-openai 不一致',
              reason_kind: 'route_endpoint_mismatch',
            },
          ],
          inference_endpoints: [customEndpoint('endpoint-openai', credentialStatus)],
        })
      ).providers[0];

    expect(unadmitted('configured')).toMatchObject({ credential_available: true, models: [] });
    expect(unadmitted('missing')).toMatchObject({
      credential_available: false,
      credential_unavailable_reason: 'missing',
    });
  });

  it('自定义分组的停用条目归分组、只能删除；归属已不存在的放进“未归类”', () => {
    const result = ModelPickerSnapshotSchema.parse(
      composeSelectableModelMenu(
        input({
          custom_api_groups: [{ name: 'Relay', inference_endpoint_ids: ['relay'] }],
          inference_endpoints: [customEndpoint('relay'), customEndpoint('gone')],
          unadmitted_models: [
            {
              id: 'relay-legacy',
              inference_endpoint_id: 'relay',
              custom_api_group_name: 'Relay',
              display_name: 'kimi-k3-legacy',
              reason: '用户模型 relay-legacy 必须声明唯一的推理 route',
              reason_kind: 'multiple_routes',
            },
            {
              id: 'orphan',
              inference_endpoint_id: 'gone',
              custom_api_group_name: undefined,
              display_name: undefined,
              reason: 'InferenceEndpoint 不存在: gone-old',
              reason_kind: 'endpoint_missing',
            },
            // 没有 ID 的条目无法删除或引用，不进入设置页。
            {
              id: undefined,
              inference_endpoint_id: undefined,
              custom_api_group_name: undefined,
              display_name: 'nameless',
              reason: 'Invalid model config: expected object',
              reason_kind: 'invalid_structure',
            },
          ],
        })
      )
    );

    expect(result.custom_providers?.[0]?.unadmitted_models).toEqual([
      expect.objectContaining({ model_config_id: 'relay-legacy', repairable: false }),
    ]);
    expect(result.unassigned_unadmitted_models).toEqual([
      {
        model_config_id: 'orphan',
        display_name: 'orphan',
        reason_kind: 'endpoint_missing',
        reason: 'InferenceEndpoint 不存在: gone-old',
        repairable: false,
      },
    ]);
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
        custom_api_groups: [{ name: '自定义模型', inference_endpoint_ids: ['custom-endpoint'] }],
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
      credential_kind: 'api_key',
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
      credential_kind: 'none',
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
      credential_kind: 'provider_account',
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
