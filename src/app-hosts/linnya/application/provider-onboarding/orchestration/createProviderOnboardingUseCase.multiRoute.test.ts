import { describe, expect, it } from 'vitest';

import type { ProviderConnectionDefinition, ProviderDefinition } from '@linnya/provider-catalog';

import type { ProviderOnboardingRuntimeBindingPort } from '../definitions/providerOnboardingPorts';
import { createStatefulProviderOnboardingStorage } from './__tests__/fixtures/providerOnboardingStateFixture';
import { createProviderOnboardingUseCase } from './createProviderOnboardingUseCase';

const SOURCE_SHA = 'a'.repeat(64);
const BASE_URL = 'https://opencode.ai/zen/go/v1';
const OPENCODE_GO_CONNECTION: ProviderConnectionDefinition = {
  id: 'opencode-go',
  display_name: 'OpenCode Go',
  kind: 'direct',
  release_status: 'preview',
  setup_fields: [{ id: 'api_key', kind: 'secret', required: true, label: 'API Key' }],
  model_discovery: 'bundled',
  models: [
    ['glm-5.3-flash', 'GLM-5.3 Flash'],
    ['gpt-5.6-luna', 'GPT-5.6 Luna'],
    ['qwen3.8-max', 'Qwen3.8 Max'],
  ].map(([id, displayName]) => ({
    id,
    display_name: displayName,
    release_status: 'active',
    context_window_tokens: 1_000_000,
    max_input_tokens: 900_000,
    max_output_tokens: 100_000,
    capabilities: { image_input: true, tool_call: true, reasoning: true },
  })),
};
const OPENCODE_GO_PROVIDER: ProviderDefinition = {
  id: 'opencode-go',
  display_name: 'OpenCode Go',
  connections: [OPENCODE_GO_CONNECTION],
};

function runtimeBindings(): ProviderOnboardingRuntimeBindingPort {
  return {
    generation_id: 'generation-1',
    source_sha256: SOURCE_SHA,
    get: providerId =>
      providerId === 'opencode-go'
        ? {
            provider_definition_id: 'opencode-go',
            provider_connection_definition_id: 'opencode-go',
            endpoint_id: 'opencode-go',
            default_base_url: BASE_URL,
            auth_profile: 'bearer',
            default_route_profile_id: 'openai_compatible_chat',
            model_route_bindings: [
              {
                model_id: 'gpt-5.6-luna',
                base_url: BASE_URL,
                route_profile_id: 'openai_responses',
              },
              {
                model_id: 'qwen3.8-max',
                base_url: BASE_URL,
                route_profile_id: 'anthropic_messages',
              },
            ],
          }
        : undefined,
  };
}

describe('OpenCode Go Provider onboarding', () => {
  it('用一份 API Key 注册 Chat、Responses 与 Anthropic 三条模型 route', async () => {
    const state = createStatefulProviderOnboardingStorage();
    const ids = [
      'go-chat-model',
      'go-chat-endpoint',
      'configured-go',
      'go-chat-intent',
      'go-responses-model',
      'go-responses-endpoint',
      'go-responses-intent',
      'go-anthropic-model',
      'go-anthropic-endpoint',
      'go-anthropic-intent',
    ];
    const useCase = createProviderOnboardingUseCase({
      providerCatalog: {
        generation: {
          id: 'generation-1',
          source_url: 'https://models.dev/api.json',
          source_sha256: SOURCE_SHA,
          synced_at: '2026-08-21T00:00:00.000Z',
          policy_version: 10,
        },
        getConnection: providerConnectionId =>
          providerConnectionId === 'opencode-go'
            ? { provider: OPENCODE_GO_PROVIDER, connection: OPENCODE_GO_CONNECTION }
            : undefined,
      },
      runtimeBindings: runtimeBindings(),
      modelCatalog: state.catalog,
      providerConfigurations: state.configurations,
      providerAccounts: { findConnectedAccountId: () => undefined },
      accountModels: { discoverModels: async () => [] },
      modelRemoval: { remove: async () => undefined },
      idFactory: { create: () => ids.shift() ?? 'unexpected-id' },
    });

    await useCase.registerDirectProviderModel({
      provider_connection_definition_id: 'opencode-go',
      provider_model_id: 'glm-5.3-flash',
      api_key: 'go-api-key',
    });
    await useCase.registerDirectProviderModel({
      provider_connection_definition_id: 'opencode-go',
      provider_model_id: 'gpt-5.6-luna',
    });
    await useCase.registerDirectProviderModel({
      provider_connection_definition_id: 'opencode-go',
      provider_model_id: 'qwen3.8-max',
    });

    expect(
      state.catalog.registerUserModel.mock.calls.map(([model]) => ({
        model: model.model_name,
        surface: model.inference_route?.api_surface,
        capability: model.inference_route?.capability_id,
        imageInput: model.inference_route?.input_support,
      }))
    ).toEqual([
      {
        model: 'glm-5.3-flash',
        surface: 'openai_chat_completions',
        capability: 'ai-sdk:openai-compatible',
        imageInput: { user_image: true, tool_result_image: false },
      },
      {
        model: 'gpt-5.6-luna',
        surface: 'openai_responses',
        capability: 'ai-sdk:openai-responses',
        imageInput: { user_image: true, tool_result_image: true },
      },
      {
        model: 'qwen3.8-max',
        surface: 'anthropic_messages',
        capability: 'ai-sdk:anthropic-messages',
        imageInput: { user_image: true, tool_result_image: true },
      },
    ]);
    expect(
      state.readEndpoints().map(endpoint => ({
        profile: endpoint.route_profile_id,
        baseUrl: endpoint.base_url,
        credential: endpoint.credential_reference,
      }))
    ).toEqual([
      {
        profile: 'openai_compatible_chat',
        baseUrl: BASE_URL,
        credential: { kind: 'stored_secret', credential_id: 'configured-provider:configured-go' },
      },
      {
        profile: 'openai_responses',
        baseUrl: BASE_URL,
        credential: { kind: 'stored_secret', credential_id: 'configured-provider:configured-go' },
      },
      {
        profile: 'anthropic_messages',
        baseUrl: BASE_URL,
        credential: { kind: 'stored_secret', credential_id: 'configured-provider:configured-go' },
      },
    ]);
    expect(state.readConfiguredProvider()?.models).toHaveLength(3);

    const flashModel = state.readModels().find(model => model.model_name === 'glm-5.3-flash');
    if (!flashModel?.inference_route) throw new Error('GLM-5.3 Flash fixture missing');
    await state.catalog.updateModel({
      ...flashModel,
      capabilities: ['chat'],
      inference_route: {
        ...flashModel.inference_route,
        input_support: { user_image: false, tool_result_image: false },
      },
    });

    await useCase.refreshRegisteredBundledProviderModels('opencode-go');

    const refreshedFlash = state.readModels().find(model => model.model_name === 'glm-5.3-flash');
    expect(refreshedFlash?.capabilities).toEqual(['chat', 'image_input']);
    expect(refreshedFlash?.inference_route?.input_support).toEqual({
      user_image: true,
      tool_result_image: false,
    });
    expect(state.readConfiguredProvider()?.models).toHaveLength(3);
  });
});
