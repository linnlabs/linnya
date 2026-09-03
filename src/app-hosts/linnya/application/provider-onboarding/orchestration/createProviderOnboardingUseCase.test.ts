import { describe, expect, it, vi } from 'vitest';

import type { ProviderConnectionDefinition, ProviderDefinition } from '@linnya/provider-catalog';
import type { ModelConfig } from 'src/domains/model-catalog';
import type { ProviderAccountModelDefinition } from 'src/domains/provider-account';

import type {
  ProviderOnboardingConfigurationPort,
  ProviderOnboardingModelCatalogPort,
  ProviderOnboardingRuntimeBindingPort,
} from '../definitions/providerOnboardingPorts';
import { createStatefulProviderOnboardingStorage } from './__tests__/fixtures/providerOnboardingStateFixture';
import { createProviderOnboardingUseCase } from './createProviderOnboardingUseCase';

const SHA = 'a'.repeat(64);
const OPENAI_API_CONNECTION: ProviderConnectionDefinition = {
  id: 'openai-api',
  display_name: 'OpenAI API',
  kind: 'direct',
  release_status: 'stable',
  setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
  model_discovery: 'bundled',
  models: [
    {
      id: 'gpt-existing',
      display_name: 'GPT Existing',
      release_status: 'active',
      context_window_tokens: 256_000,
      max_input_tokens: 240_000,
      max_output_tokens: 16_000,
      capabilities: { image_input: true, tool_call: true, reasoning: true },
    },
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
};

const CHATGPT_SUBSCRIPTION_CONNECTION: ProviderConnectionDefinition = {
  id: 'openai-chatgpt-subscription',
  display_name: 'ChatGPT 订阅',
  kind: 'direct',
  release_status: 'preview',
  setup_fields: [
    { id: 'authorization', kind: 'oauth', required: true, label: '使用 ChatGPT 登录' },
  ],
  model_discovery: 'account_catalog',
  models: [],
};

const OPENAI_PROVIDER: ProviderDefinition = {
  id: 'openai',
  display_name: 'OpenAI',
  connections: [OPENAI_API_CONNECTION, CHATGPT_SUBSCRIPTION_CONNECTION],
};

const CHATGPT_ACCOUNT_MODELS: readonly ProviderAccountModelDefinition[] = [
  {
    id: 'gpt-5.6-sol',
    display_name: 'GPT-5.6 Sol',
    context_window_tokens: 272_000,
    max_input_tokens: 258_400,
    max_output_tokens: 13_600,
    capabilities: { image_input: true, tool_call: true, reasoning: true },
  },
  {
    id: 'gpt-5.6-terra',
    display_name: 'GPT-5.6 Terra',
    context_window_tokens: 272_000,
    max_input_tokens: 258_400,
    max_output_tokens: 13_600,
    capabilities: { image_input: true, tool_call: true, reasoning: true },
  },
];

function runtimeBindings(): ProviderOnboardingRuntimeBindingPort {
  return {
    generation_id: 'generation-1',
    source_sha256: SHA,
    get: providerConnectionId => {
      if (providerConnectionId === 'openai-api') {
        return {
          provider_definition_id: 'openai',
          provider_connection_definition_id: 'openai-api',
          endpoint_id: 'openai',
          default_base_url: 'https://api.openai.com/v1',
          auth_profile: 'bearer',
          default_route_profile_id: 'openai_responses',
        };
      }
      if (providerConnectionId === 'openai-chatgpt-subscription') {
        return {
          provider_definition_id: 'openai',
          provider_connection_definition_id: 'openai-chatgpt-subscription',
          endpoint_id: 'chatgpt',
          default_base_url: 'https://chatgpt.com/backend-api/codex',
          auth_profile: 'bearer',
          default_route_profile_id: 'chatgpt_codex_responses',
        };
      }
      return undefined;
    },
  };
}

function providerAccounts(accountId?: string) {
  return {
    findConnectedAccountId: (providerConnectionDefinitionId: string) =>
      providerConnectionDefinitionId === 'openai-chatgpt-subscription' ? accountId : undefined,
  };
}

function accountModels(models: readonly ProviderAccountModelDefinition[] = []) {
  return { discoverModels: vi.fn(async () => models) };
}

function modelRemoval() {
  return { remove: vi.fn(async () => undefined) };
}

function modelCatalog(): ProviderOnboardingModelCatalogPort & {
  registerUserModel: ReturnType<typeof vi.fn>;
} {
  return {
    getModel: () => undefined,
    getInferenceEndpoints: () => [],
    registerUserModel: vi.fn(async (_model: ModelConfig) => undefined),
    updateModel: vi.fn(async (_model: ModelConfig) => undefined),
  };
}

function providerConfigurations(): ProviderOnboardingConfigurationPort & {
  beginModelRegistration: ReturnType<typeof vi.fn>;
  completeModelRegistration: ReturnType<typeof vi.fn>;
  cancelModelRegistration: ReturnType<typeof vi.fn>;
} {
  return {
    getByProviderConnectionDefinitionId: () => undefined,
    beginModelRegistration: vi.fn(async () => ({
      id: 'registration-intent',
      configured_provider_id: 'configured-provider',
      provider_definition_id: 'openai',
      provider_connection_definition_id: 'openai-api',
      inference_endpoint_id: 'endpoint',
      provider_model_id: 'gpt-test',
      model_config_id: 'model',
    })),
    completeModelRegistration: vi.fn(async () => undefined),
    cancelModelRegistration: vi.fn(async () => undefined),
  };
}

describe('createProviderOnboardingUseCase', () => {
  it('首次只用 Key 连接 Provider，并自动注册三个最新稳定模型', async () => {
    const connection: ProviderConnectionDefinition = {
      ...OPENAI_API_CONNECTION,
      models: [
        {
          ...OPENAI_API_CONNECTION.models[0]!,
          id: 'old',
          display_name: 'Old',
          release_date: '2026-01-01',
        },
        {
          ...OPENAI_API_CONNECTION.models[0]!,
          id: 'newest',
          display_name: 'Newest',
          release_date: '2026-08-01',
        },
        {
          ...OPENAI_API_CONNECTION.models[0]!,
          id: 'middle',
          display_name: 'Middle',
          release_date: '2026-06-01',
        },
        {
          ...OPENAI_API_CONNECTION.models[0]!,
          id: 'new',
          display_name: 'New',
          release_date: '2026-07-01',
        },
      ],
    };
    const provider: ProviderDefinition = { ...OPENAI_PROVIDER, connections: [connection] };
    const storage = createStatefulProviderOnboardingStorage();
    let id = 0;
    const useCase = createProviderOnboardingUseCase({
      providerCatalog: {
        generation: {
          id: 'generation-1',
          source_url: 'https://models.dev/api.json',
          source_sha256: SHA,
          synced_at: '2026-08-20T00:00:00.000Z',
          policy_version: 1,
        },
        getConnection: connectionId =>
          connectionId === connection.id ? { provider, connection } : undefined,
      },
      runtimeBindings: runtimeBindings(),
      modelCatalog: storage.catalog,
      providerConfigurations: storage.configurations,
      providerAccounts: providerAccounts(),
      accountModels: accountModels(),
      modelRemoval: modelRemoval(),
      idFactory: { create: () => `generated-${++id}` },
    });

    const result = await useCase.configureDirectProvider({
      provider_connection_definition_id: connection.id,
      api_key: 'secret-value',
    });

    expect(storage.readConfiguredProvider()?.models.map(model => model.provider_model_id)).toEqual([
      'newest',
      'new',
      'middle',
    ]);
    expect(result.model_ids).toHaveLength(3);
    expect(storage.readEndpoints()).toHaveLength(1);
  });

  it('由目录与私有 binding 创建完整 typed route，command 不承载协议字段', async () => {
    const catalog = modelCatalog();
    const configurations = providerConfigurations();
    const ids = [
      'model-local-1',
      'endpoint-local-1',
      'configured-provider-1',
      'registration-intent-1',
    ];
    const useCase = createProviderOnboardingUseCase({
      providerCatalog: {
        generation: {
          id: 'generation-1',
          source_url: 'https://models.dev/api.json',
          source_sha256: SHA,
          synced_at: '2026-08-20T00:00:00.000Z',
          policy_version: 1,
        },
        getConnection: providerConnectionId =>
          providerConnectionId === 'openai-api'
            ? { provider: OPENAI_PROVIDER, connection: OPENAI_API_CONNECTION }
            : undefined,
      },
      runtimeBindings: runtimeBindings(),
      modelCatalog: catalog,
      providerConfigurations: configurations,
      providerAccounts: providerAccounts(),
      accountModels: accountModels(),
      modelRemoval: modelRemoval(),
      idFactory: { create: () => ids.shift() ?? 'unexpected-id' },
    });

    await expect(
      useCase.registerDirectProviderModel({
        provider_connection_definition_id: 'openai-api',
        provider_model_id: 'gpt-test',
        api_key: 'secret-value',
      })
    ).resolves.toEqual({
      model_id: 'model-local-1',
      provider_definition_id: 'openai',
      provider_connection_definition_id: 'openai-api',
      provider_model_id: 'gpt-test',
    });

    expect(catalog.registerUserModel).toHaveBeenCalledOnce();
    expect(configurations.beginModelRegistration).toHaveBeenCalledWith({
      intent_id: 'registration-intent-1',
      configured_provider_id: 'configured-provider-1',
      provider_definition_id: 'openai',
      provider_connection_definition_id: 'openai-api',
      inference_endpoint_id: 'endpoint-local-1',
      provider_model_id: 'gpt-test',
      model_config_id: 'model-local-1',
    });
    expect(configurations.completeModelRegistration).toHaveBeenCalledWith('registration-intent-1');
    const [model, endpoint] = catalog.registerUserModel.mock.calls[0] ?? [];
    expect(model).toMatchObject({
      id: 'model-local-1',
      model_name: 'gpt-test',
      capabilities: ['chat', 'image_input'],
      inference_route: {
        api_surface: 'openai_responses',
        capability_id: 'ai-sdk:openai-responses',
        endpoint_model_id: 'gpt-test',
        context_window_tokens: 256_000,
        max_output_tokens: 16_000,
        input_support: { user_image: true, tool_result_image: true },
      },
    });
    expect(endpoint).toMatchObject({
      kind: 'create',
      endpoint: {
        id: 'endpoint-local-1',
        endpoint_id: 'openai:endpoint-local-1',
        credential_secret: 'secret-value',
      },
    });
  });

  it('拒绝 public catalog 与 private binding 代际不一致', async () => {
    const useCase = createProviderOnboardingUseCase({
      providerCatalog: {
        generation: {
          id: 'generation-2',
          source_url: 'https://models.dev/api.json',
          source_sha256: SHA,
          synced_at: '2026-08-20T00:00:00.000Z',
          policy_version: 1,
        },
        getConnection: () => ({
          provider: OPENAI_PROVIDER,
          connection: OPENAI_API_CONNECTION,
        }),
      },
      runtimeBindings: runtimeBindings(),
      modelCatalog: modelCatalog(),
      providerConfigurations: providerConfigurations(),
      providerAccounts: providerAccounts(),
      accountModels: accountModels(),
      modelRemoval: modelRemoval(),
      idFactory: { create: () => 'unused' },
    });

    await expect(
      useCase.registerDirectProviderModel({
        provider_connection_definition_id: 'openai-api',
        provider_model_id: 'gpt-test',
        api_key: 'secret-value',
      })
    ).rejects.toMatchObject({
      code: 'provider_onboarding.catalog_generation_mismatch',
      statusCode: 500,
    });
  });

  it('同一正式 Provider 复用稳定 endpoint，并在原 credential boundary 替换 Key', async () => {
    const catalog = modelCatalog();
    catalog.getInferenceEndpoints = () => [
      {
        id: 'existing-endpoint',
        route_profile_id: 'openai_responses',
        endpoint_id: 'openai:existing-endpoint',
        base_url: 'https://api.openai.com/v1',
        auth_profile: 'bearer',
        credential_reference: {
          kind: 'stored_secret',
          credential_id: 'inference-endpoint:existing-endpoint',
        },
        credential_status: 'configured',
      },
    ];
    const configurations = providerConfigurations();
    catalog.getModel = modelConfigId =>
      modelConfigId === 'existing-model'
        ? {
            id: 'existing-model',
            model_name: 'gpt-existing',
            catalog_source: 'user',
            inference_endpoint_id: 'existing-endpoint',
            capabilities: ['chat'],
            ui_visibility: [],
            display_name: 'GPT Existing',
            description: '',
          }
        : undefined;
    configurations.getByProviderConnectionDefinitionId = () => ({
      id: 'configured-openai',
      provider_definition_id: 'openai',
      provider_connection_definition_id: 'openai-api',
      models: [{ provider_model_id: 'gpt-existing', model_config_id: 'existing-model' }],
    });
    const ids = ['model-local-2', 'registration-intent-2'];
    const useCase = createProviderOnboardingUseCase({
      providerCatalog: {
        generation: {
          id: 'generation-1',
          source_url: 'https://models.dev/api.json',
          source_sha256: SHA,
          synced_at: '2026-08-20T00:00:00.000Z',
          policy_version: 1,
        },
        getConnection: () => ({
          provider: OPENAI_PROVIDER,
          connection: OPENAI_API_CONNECTION,
        }),
      },
      runtimeBindings: runtimeBindings(),
      modelCatalog: catalog,
      providerConfigurations: configurations,
      providerAccounts: providerAccounts(),
      accountModels: accountModels(),
      modelRemoval: modelRemoval(),
      idFactory: { create: () => ids.shift() ?? 'unexpected-id' },
    });

    await useCase.registerDirectProviderModel({
      provider_connection_definition_id: 'openai-api',
      provider_model_id: 'gpt-test',
      api_key: 'replacement-secret',
    });

    expect(catalog.registerUserModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'model-local-2' }),
      {
        kind: 'existing',
        inference_endpoint_id: 'existing-endpoint',
        credential_secret: 'replacement-secret',
      }
    );
    expect(configurations.beginModelRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        configured_provider_id: 'configured-openai',
        inference_endpoint_id: 'existing-endpoint',
        intent_id: 'registration-intent-2',
      })
    );
  });

  it('拒绝重复注册同一 Provider 模型，不创建第二个 ModelConfig', async () => {
    const catalog = modelCatalog();
    const configurations = providerConfigurations();
    configurations.getByProviderConnectionDefinitionId = () => ({
      id: 'configured-openai',
      provider_definition_id: 'openai',
      provider_connection_definition_id: 'openai-api',
      models: [{ provider_model_id: 'gpt-test', model_config_id: 'existing-model' }],
    });
    const createId = vi.fn(() => 'must-not-create');
    const useCase = createProviderOnboardingUseCase({
      providerCatalog: {
        generation: {
          id: 'generation-1',
          source_url: 'https://models.dev/api.json',
          source_sha256: SHA,
          synced_at: '2026-08-20T00:00:00.000Z',
          policy_version: 1,
        },
        getConnection: () => ({
          provider: OPENAI_PROVIDER,
          connection: OPENAI_API_CONNECTION,
        }),
      },
      runtimeBindings: runtimeBindings(),
      modelCatalog: catalog,
      providerConfigurations: configurations,
      providerAccounts: providerAccounts(),
      accountModels: accountModels(),
      modelRemoval: modelRemoval(),
      idFactory: { create: createId },
    });

    await expect(
      useCase.registerDirectProviderModel({
        provider_connection_definition_id: 'openai-api',
        provider_model_id: 'gpt-test',
        api_key: 'secret-value',
      })
    ).rejects.toMatchObject({
      code: 'provider_onboarding.model_already_registered',
      statusCode: 409,
    });
    expect(createId).not.toHaveBeenCalled();
    expect(catalog.registerUserModel).not.toHaveBeenCalled();
    expect(configurations.beginModelRegistration).not.toHaveBeenCalled();
  });

  it('Model Catalog 写入失败时撤销 durable intent，不创建 Provider 归属', async () => {
    const catalog = modelCatalog();
    catalog.registerUserModel.mockRejectedValueOnce(new Error('disk unavailable'));
    const configurations = providerConfigurations();
    const ids = ['model-local-3', 'endpoint-local-3', 'configured-provider-3', 'intent-3'];
    const useCase = createProviderOnboardingUseCase({
      providerCatalog: {
        generation: {
          id: 'generation-1',
          source_url: 'https://models.dev/api.json',
          source_sha256: SHA,
          synced_at: '2026-08-20T00:00:00.000Z',
          policy_version: 1,
        },
        getConnection: () => ({
          provider: OPENAI_PROVIDER,
          connection: OPENAI_API_CONNECTION,
        }),
      },
      runtimeBindings: runtimeBindings(),
      modelCatalog: catalog,
      providerConfigurations: configurations,
      providerAccounts: providerAccounts(),
      accountModels: accountModels(),
      modelRemoval: modelRemoval(),
      idFactory: { create: () => ids.shift() ?? 'unexpected-id' },
    });

    await expect(
      useCase.registerDirectProviderModel({
        provider_connection_definition_id: 'openai-api',
        provider_model_id: 'gpt-test',
        api_key: 'secret-value',
      })
    ).rejects.toMatchObject({ code: 'provider_onboarding.registration_failed' });

    expect(configurations.cancelModelRegistration).toHaveBeenCalledWith('intent-3');
  });

  it('模型已注册但归属提交失败时保留 durable intent 并返回成功', async () => {
    const catalog = modelCatalog();
    const configurations = providerConfigurations();
    configurations.completeModelRegistration.mockRejectedValueOnce(new Error('disk unavailable'));
    const ids = ['model-local-4', 'endpoint-local-4', 'configured-provider-4', 'intent-4'];
    const useCase = createProviderOnboardingUseCase({
      providerCatalog: {
        generation: {
          id: 'generation-1',
          source_url: 'https://models.dev/api.json',
          source_sha256: SHA,
          synced_at: '2026-08-20T00:00:00.000Z',
          policy_version: 1,
        },
        getConnection: () => ({
          provider: OPENAI_PROVIDER,
          connection: OPENAI_API_CONNECTION,
        }),
      },
      runtimeBindings: runtimeBindings(),
      modelCatalog: catalog,
      providerConfigurations: configurations,
      providerAccounts: providerAccounts(),
      accountModels: accountModels(),
      modelRemoval: modelRemoval(),
      idFactory: { create: () => ids.shift() ?? 'unexpected-id' },
    });

    await expect(
      useCase.registerDirectProviderModel({
        provider_connection_definition_id: 'openai-api',
        provider_model_id: 'gpt-test',
        api_key: 'secret-value',
      })
    ).resolves.toMatchObject({ model_id: 'model-local-4' });

    expect(configurations.cancelModelRegistration).not.toHaveBeenCalled();
  });

  it('ChatGPT 登录后自动同步完整模型目录，复用账号 endpoint 且可重复执行', async () => {
    const state = createStatefulProviderOnboardingStorage();
    const { catalog, configurations } = state;
    let connectedAccountId: string | undefined;
    const ids = [
      'chatgpt-model-1',
      'chatgpt-endpoint-1',
      'configured-chatgpt-1',
      'chatgpt-intent-1',
      'chatgpt-model-2',
      'chatgpt-intent-2',
    ];
    const discoverModels = vi
      .fn()
      .mockResolvedValueOnce(CHATGPT_ACCOUNT_MODELS)
      .mockResolvedValueOnce([
        {
          ...CHATGPT_ACCOUNT_MODELS[0],
          context_window_tokens: 300_000,
          max_input_tokens: 285_000,
          max_output_tokens: 15_000,
        },
        CHATGPT_ACCOUNT_MODELS[1],
      ])
      .mockResolvedValueOnce([
        {
          ...CHATGPT_ACCOUNT_MODELS[0],
          context_window_tokens: 300_000,
          max_input_tokens: 285_000,
          max_output_tokens: 15_000,
        },
      ]);
    const removal = modelRemoval();
    const useCase = createProviderOnboardingUseCase({
      providerCatalog: {
        generation: {
          id: 'generation-1',
          source_url: 'https://models.dev/api.json',
          source_sha256: SHA,
          synced_at: '2026-08-20T00:00:00.000Z',
          policy_version: 1,
        },
        getConnection: providerConnectionId =>
          providerConnectionId === 'openai-chatgpt-subscription'
            ? {
                provider: OPENAI_PROVIDER,
                connection: CHATGPT_SUBSCRIPTION_CONNECTION,
              }
            : undefined,
      },
      runtimeBindings: runtimeBindings(),
      modelCatalog: catalog,
      providerConfigurations: configurations,
      providerAccounts: {
        findConnectedAccountId: providerConnectionId =>
          providerConnectionId === 'openai-chatgpt-subscription' ? connectedAccountId : undefined,
      },
      accountModels: { discoverModels },
      modelRemoval: removal,
      idFactory: { create: () => ids.shift() ?? 'unexpected-id' },
    });

    await expect(
      useCase.synchronizeConnectedProviderModels('openai-chatgpt-subscription')
    ).rejects.toMatchObject({
      code: 'provider_onboarding.authorization_required',
    });

    connectedAccountId = 'chatgpt-subscription';
    await useCase.synchronizeConnectedProviderModels('openai-chatgpt-subscription');
    await useCase.synchronizeConnectedProviderModels('openai-chatgpt-subscription');
    await useCase.synchronizeConnectedProviderModels('openai-chatgpt-subscription');

    expect(catalog.registerUserModel).toHaveBeenCalledTimes(2);
    expect(catalog.updateModel).toHaveBeenCalledTimes(1);
    expect(removal.remove).toHaveBeenCalledWith('chatgpt-model-2');
    expect(catalog.registerUserModel).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        model_name: 'gpt-5.6-sol',
        inference_route: expect.objectContaining({
          capability_id: 'ai-sdk:openai-responses',
          base_url: 'https://chatgpt.com/backend-api/codex',
          context_window_tokens: 272_000,
          max_output_tokens: 13_600,
        }),
      }),
      expect.objectContaining({
        kind: 'create',
        endpoint: expect.objectContaining({
          credential_reference: {
            kind: 'provider_account',
            account_id: 'chatgpt-subscription',
          },
          credential_secret: undefined,
        }),
      })
    );
    expect(catalog.registerUserModel).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model_name: 'gpt-5.6-terra' }),
      {
        kind: 'existing',
        inference_endpoint_id: 'chatgpt-endpoint-1',
        credential_secret: undefined,
      }
    );
    expect(state.readConfiguredProvider()?.models).toHaveLength(2);
    expect(
      state.readModels().find(model => model.model_name === 'gpt-5.6-sol')?.inference_route
        ?.context_window_tokens
    ).toBe(300_000);
  });
});
