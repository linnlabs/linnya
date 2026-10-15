import { describe, expect, it } from 'vitest';

import type { ProviderConnectionDefinition, ProviderDefinition } from '@linnya/provider-catalog';

import type { ProviderOnboardingRuntimeBindingPort } from '../definitions/providerOnboardingPorts';
import { createStatefulProviderOnboardingStorage } from './__tests__/fixtures/providerOnboardingStateFixture';
import { createProviderOnboardingUseCase } from './createProviderOnboardingUseCase';

const SHA = 'b'.repeat(64);

const API_KEY_CONNECTION: ProviderConnectionDefinition = {
  id: 'openai-api',
  display_name: 'OpenAI API',
  kind: 'direct',
  release_status: 'stable',
  setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
  model_discovery: 'bundled',
  models: ['gpt-a', 'gpt-b'].map(id => ({
    id,
    display_name: id,
    release_status: 'active' as const,
    context_window_tokens: 256_000,
    max_input_tokens: 240_000,
    max_output_tokens: 16_000,
    capabilities: { image_input: false, tool_call: true, reasoning: false },
  })),
};

const ACCOUNT_CONNECTION: ProviderConnectionDefinition = {
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

const PROVIDER: ProviderDefinition = {
  id: 'openai',
  display_name: 'OpenAI',
  connections: [API_KEY_CONNECTION, ACCOUNT_CONNECTION],
};

const RUNTIME_BINDINGS: ProviderOnboardingRuntimeBindingPort = {
  generation_id: 'generation-1',
  source_sha256: SHA,
  get: providerConnectionId =>
    providerConnectionId === API_KEY_CONNECTION.id
      ? {
          provider_definition_id: 'openai',
          provider_connection_definition_id: API_KEY_CONNECTION.id,
          endpoint_id: 'openai',
          default_base_url: 'https://api.openai.com/v1',
          auth_profile: 'bearer',
          default_route_profile_id: 'openai_responses',
        }
      : undefined,
};

function setup() {
  const storage = createStatefulProviderOnboardingStorage();
  let id = 0;
  const useCase = createProviderOnboardingUseCase({
    discoveredModels: { readAvailable: () => undefined },
    providerCatalog: {
      generation: {
        id: 'generation-1',
        source_url: 'https://models.dev/api.json',
        source_sha256: SHA,
        synced_at: '2026-08-20T00:00:00.000Z',
        policy_version: 1,
      },
      getConnection: connectionId => {
        const connection = PROVIDER.connections.find(candidate => candidate.id === connectionId);
        return connection ? { provider: PROVIDER, connection } : undefined;
      },
    },
    runtimeBindings: RUNTIME_BINDINGS,
    modelCatalog: storage.catalog,
    providerConfigurations: storage.configurations,
    providerAccounts: { findConnectedAccountId: () => undefined },
    accountModels: { discoverModels: async () => [] },
    modelRemoval: { remove: async () => undefined },
    idFactory: { create: () => `generated-${++id}` },
  });
  return { storage, useCase };
}

describe('createProviderOnboardingUseCase.replaceDirectProviderCredential', () => {
  it('在已连接 Provider 唯一的凭据边界内替换 Key，不新增 endpoint 或改写模型', async () => {
    const { storage, useCase } = setup();
    await useCase.configureDirectProvider({
      provider_connection_definition_id: API_KEY_CONNECTION.id,
      api_key: 'original-secret',
    });
    const endpointsBefore = storage.readEndpoints();
    const modelsBefore = storage.readModels();

    await useCase.replaceDirectProviderCredential({
      provider_connection_definition_id: API_KEY_CONNECTION.id,
      api_key: 'rotated-secret',
    });

    expect(storage.catalog.replaceInferenceEndpointCredential).toHaveBeenCalledOnce();
    expect(storage.catalog.replaceInferenceEndpointCredential).toHaveBeenCalledWith(
      endpointsBefore[0]?.id,
      'rotated-secret'
    );
    expect(storage.readEndpoints().map(endpoint => endpoint.id)).toEqual(
      endpointsBefore.map(endpoint => endpoint.id)
    );
    expect(storage.readModels()).toEqual(modelsBefore);
  });

  it('账号型 connection 不接受 Key，未连接的 Provider 明确返回不存在', async () => {
    const { storage, useCase } = setup();

    await expect(
      useCase.replaceDirectProviderCredential({
        provider_connection_definition_id: ACCOUNT_CONNECTION.id,
        api_key: 'secret-value',
      })
    ).rejects.toMatchObject({ code: 'provider_onboarding.provider_not_supported' });
    await expect(
      useCase.replaceDirectProviderCredential({
        provider_connection_definition_id: API_KEY_CONNECTION.id,
        api_key: 'secret-value',
      })
    ).rejects.toMatchObject({ code: 'provider_onboarding.provider_not_found', statusCode: 404 });
    await expect(
      useCase.replaceDirectProviderCredential({
        provider_connection_definition_id: 'unknown-connection',
        api_key: 'secret-value',
      })
    ).rejects.toMatchObject({ code: 'provider_onboarding.provider_not_found' });
    expect(storage.catalog.replaceInferenceEndpointCredential).not.toHaveBeenCalled();
  });

  it('密文写入失败时返回稳定错误码，不暴露底层异常', async () => {
    const { storage, useCase } = setup();
    await useCase.configureDirectProvider({
      provider_connection_definition_id: API_KEY_CONNECTION.id,
      api_key: 'original-secret',
    });
    storage.catalog.replaceInferenceEndpointCredential.mockRejectedValueOnce(
      new Error('keyring unavailable')
    );

    await expect(
      useCase.replaceDirectProviderCredential({
        provider_connection_definition_id: API_KEY_CONNECTION.id,
        api_key: 'rotated-secret',
      })
    ).rejects.toMatchObject({
      code: 'provider_onboarding.credential_replacement_failed',
      message: 'Provider API Key 更新失败',
    });
  });
});
