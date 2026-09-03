import { describe, expect, it, vi } from 'vitest';
import type { ProviderConnectionDefinition, ProviderDefinition } from '@linnya/provider-catalog';
import type { ModelConfig } from 'src/domains/model-catalog';
import type {
  OllamaOnboardingConfigurationPort,
  OllamaOnboardingModelCatalogPort,
} from '../definitions/ollamaOnboardingPorts';
import { createOllamaOnboardingUseCase } from './createOllamaOnboardingUseCase';

const OLLAMA_CONNECTION: ProviderConnectionDefinition = {
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
};
const OLLAMA_PROVIDER: ProviderDefinition = {
  id: 'ollama',
  display_name: 'Ollama',
  connections: [OLLAMA_CONNECTION],
};

function modelCatalog(): OllamaOnboardingModelCatalogPort & {
  registerUserModel: ReturnType<typeof vi.fn>;
} {
  return {
    getModel: () => undefined,
    getInferenceEndpoints: () => [],
    registerUserModel: vi.fn(async (_model: ModelConfig) => undefined),
  };
}

function providerConfigurations(): OllamaOnboardingConfigurationPort & {
  beginModelRegistration: ReturnType<typeof vi.fn>;
  completeModelRegistration: ReturnType<typeof vi.fn>;
  cancelModelRegistration: ReturnType<typeof vi.fn>;
} {
  return {
    getByProviderConnectionDefinitionId: () => undefined,
    beginModelRegistration: vi.fn(async input => ({
      id: input.intent_id,
      configured_provider_id: input.configured_provider_id,
      provider_definition_id: input.provider_definition_id,
      provider_connection_definition_id: input.provider_connection_definition_id,
      inference_endpoint_id: input.inference_endpoint_id,
      provider_model_id: input.provider_model_id,
      model_config_id: input.model_config_id,
    })),
    completeModelRegistration: vi.fn(async () => undefined),
    cancelModelRegistration: vi.fn(async () => undefined),
  };
}

const command = {
  provider_connection_definition_id: 'ollama',
  service_url: 'http://localhost:11434',
  endpoint_model_id: 'qwen3:8b',
  display_name: 'Local Qwen',
  context_window_tokens: 32_768,
  max_output_tokens: 4_096,
} as const;

describe('createOllamaOnboardingUseCase', () => {
  it('Host 构造 typed route、endpoint 与 ConfiguredProvider 归属', async () => {
    const catalog = modelCatalog();
    const configurations = providerConfigurations();
    const ids = ['model-1', 'endpoint-1', 'configured-ollama', 'intent-1'];
    const useCase = createOllamaOnboardingUseCase({
      providerCatalog: {
        getConnection: id =>
          id === 'ollama'
            ? { provider: OLLAMA_PROVIDER, connection: OLLAMA_CONNECTION }
            : undefined,
      },
      modelCatalog: catalog,
      providerConfigurations: configurations,
      idFactory: { create: () => ids.shift() ?? 'unexpected-id' },
    });

    await expect(useCase.registerModel(command)).resolves.toEqual({
      model_id: 'model-1',
      provider_definition_id: 'ollama',
      provider_connection_definition_id: 'ollama',
      provider_model_id: 'qwen3:8b',
    });
    expect(catalog.registerUserModel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'model-1',
        model_name: 'qwen3:8b',
        inference_route: expect.objectContaining({
          api_surface: 'openai_chat_completions',
          capability_id: 'ai-sdk:openai-compatible',
          endpoint_id: 'ollama:endpoint-1',
          base_url: 'http://localhost:11434/v1',
          auth_profile: 'none',
          context_window_tokens: 32_768,
          max_output_tokens: 4_096,
        }),
      }),
      {
        kind: 'create',
        endpoint: expect.objectContaining({
          id: 'endpoint-1',
          endpoint_id: 'ollama:endpoint-1',
          auth_profile: 'none',
        }),
      }
    );
    expect(configurations.beginModelRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        configured_provider_id: 'configured-ollama',
        provider_definition_id: 'ollama',
        provider_connection_definition_id: 'ollama',
        provider_model_id: 'qwen3:8b',
        model_config_id: 'model-1',
      })
    );
  });

  it('已有 Ollama 配置只复用同一服务 endpoint', async () => {
    const catalog = modelCatalog();
    catalog.getInferenceEndpoints = () => [
      {
        id: 'endpoint-existing',
        route_profile_id: 'openai_compatible_chat',
        endpoint_id: 'ollama:endpoint-existing',
        base_url: 'http://localhost:11434/v1',
        auth_profile: 'none',
        credential_reference: { kind: 'none' },
        credential_status: 'not_required',
      },
    ];
    const configurations = providerConfigurations();
    catalog.getModel = () => ({
      id: 'model-existing',
      model_name: 'qwen3:8b',
      catalog_source: 'user',
      inference_endpoint_id: 'endpoint-existing',
      capabilities: ['chat'],
      ui_visibility: [],
      display_name: 'Qwen',
      description: '',
    });
    configurations.getByProviderConnectionDefinitionId = () => ({
      id: 'configured-ollama',
      provider_definition_id: 'ollama',
      provider_connection_definition_id: 'ollama',
      models: [{ provider_model_id: 'qwen3:8b', model_config_id: 'model-existing' }],
    });
    const ids = ['model-2', 'intent-2'];
    const useCase = createOllamaOnboardingUseCase({
      providerCatalog: {
        getConnection: () => ({ provider: OLLAMA_PROVIDER, connection: OLLAMA_CONNECTION }),
      },
      modelCatalog: catalog,
      providerConfigurations: configurations,
      idFactory: { create: () => ids.shift() ?? 'unexpected-id' },
    });

    await useCase.registerModel({ ...command, endpoint_model_id: 'llama3.2:3b' });

    expect(catalog.registerUserModel.mock.calls[0]?.[1]).toEqual({
      kind: 'existing',
      inference_endpoint_id: 'endpoint-existing',
    });
  });

  it('已有 Ollama Provider 不允许静默切换到另一服务地址', async () => {
    const catalog = modelCatalog();
    catalog.getInferenceEndpoints = () => [
      {
        id: 'endpoint-existing',
        route_profile_id: 'openai_compatible_chat',
        endpoint_id: 'ollama:endpoint-existing',
        base_url: 'http://localhost:11434/v1',
        auth_profile: 'none',
        credential_reference: { kind: 'none' },
        credential_status: 'not_required',
      },
    ];
    const configurations = providerConfigurations();
    catalog.getModel = () => ({
      id: 'model-existing',
      model_name: 'qwen3:8b',
      catalog_source: 'user',
      inference_endpoint_id: 'endpoint-existing',
      capabilities: ['chat'],
      ui_visibility: [],
      display_name: 'Qwen',
      description: '',
    });
    configurations.getByProviderConnectionDefinitionId = () => ({
      id: 'configured-ollama',
      provider_definition_id: 'ollama',
      provider_connection_definition_id: 'ollama',
      models: [{ provider_model_id: 'qwen3:8b', model_config_id: 'model-existing' }],
    });
    const useCase = createOllamaOnboardingUseCase({
      providerCatalog: {
        getConnection: () => ({ provider: OLLAMA_PROVIDER, connection: OLLAMA_CONNECTION }),
      },
      modelCatalog: catalog,
      providerConfigurations: configurations,
      idFactory: { create: () => 'unused' },
    });

    await expect(
      useCase.registerModel({ ...command, service_url: 'http://remote-host:11434' })
    ).rejects.toMatchObject({ code: 'ollama_onboarding.configuration_mismatch' });
  });

  it('Model Catalog 失败时撤销 durable intent', async () => {
    const catalog = modelCatalog();
    catalog.registerUserModel.mockRejectedValueOnce(new Error('disk unavailable'));
    const configurations = providerConfigurations();
    const ids = ['model-3', 'endpoint-3', 'configured-3', 'intent-3'];
    const useCase = createOllamaOnboardingUseCase({
      providerCatalog: {
        getConnection: () => ({ provider: OLLAMA_PROVIDER, connection: OLLAMA_CONNECTION }),
      },
      modelCatalog: catalog,
      providerConfigurations: configurations,
      idFactory: { create: () => ids.shift() ?? 'unexpected-id' },
    });

    await expect(useCase.registerModel(command)).rejects.toMatchObject({
      code: 'ollama_onboarding.registration_failed',
    });
    expect(configurations.cancelModelRegistration).toHaveBeenCalledWith('intent-3');
  });
});
