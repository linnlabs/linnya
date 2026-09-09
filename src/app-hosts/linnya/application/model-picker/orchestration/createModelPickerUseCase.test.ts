import type { DirectProviderModelRegistrationCommand } from '@app/schemas/provider-onboarding';
import { describe, expect, it, vi } from 'vitest';

import type { ProviderConnectionDefinition, ProviderDefinition } from '@linnya/provider-catalog';

import { createModelPickerUseCase } from './createModelPickerUseCase';

const openAiConnection: ProviderConnectionDefinition = {
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
      max_input_tokens: 239_616,
      max_output_tokens: 16_384,
      capabilities: { image_input: true, tool_call: true, reasoning: true },
    },
    {
      id: 'gpt-new',
      display_name: 'GPT New',
      release_status: 'active',
      context_window_tokens: 256_000,
      max_input_tokens: 239_616,
      max_output_tokens: 16_384,
      capabilities: { image_input: true, tool_call: true, reasoning: true },
    },
  ],
};
const openai: ProviderDefinition = {
  id: 'openai',
  display_name: 'OpenAI',
  connections: [openAiConnection],
};

describe('createModelPickerUseCase', () => {
  it('激活正式 Provider 目录模型时复用 onboarding 且不再次提交 API Key', async () => {
    const commands: DirectProviderModelRegistrationCommand[] = [];
    const registerDirectProviderModel = vi.fn(async command => {
      commands.push(command);
      return {
        model_id: 'model-gpt-new',
        provider_definition_id: 'openai',
        provider_connection_definition_id: 'openai-api',
        provider_model_id: 'gpt-new',
      };
    });
    const useCase = createModelPickerUseCase({
      providerCatalog: {
        list: () => [openai],
        getConnection: id =>
          id === openAiConnection.id
            ? { provider: openai, connection: openAiConnection }
            : undefined,
      },
      providerConfigurations: {
        list: () => [
          {
            id: 'configured-openai',
            provider_definition_id: 'openai',
            provider_connection_definition_id: 'openai-api',
            models: [{ provider_model_id: 'gpt-existing', model_config_id: 'model-gpt-existing' }],
          },
        ],
        getByModelConfigId: () => undefined,
      },
      modelCatalog: {
        getModels: () => [],
        getModel: () => undefined,
        getInferenceEndpoints: () => [],
        hasCredential: () => false,
        getCredentialStatus: () => 'missing',
      },
      preferences: {
        read: () => ({ provider_preferences: [], model_preferences: [] }),
        setProviderVisibility: vi.fn(),
        setModelVisibility: vi.fn(),
      },
      providerAccounts: {
        list: () => [],
        hasCredential: () => false,
        getCredentialStatus: () => 'missing',
      },
      providerModelActivation: { registerDirectProviderModel },
    });

    await useCase.activateProviderModel('configured-openai', 'gpt-new');

    expect(commands).toEqual([
      { provider_connection_definition_id: 'openai-api', provider_model_id: 'gpt-new' },
    ]);
  });

  it('拒绝用另一个 Provider 的裸模型 ID 绕过 configured provider 归属', async () => {
    const useCase = createModelPickerUseCase({
      providerCatalog: {
        list: () => [openai],
        getConnection: id =>
          id === openAiConnection.id
            ? { provider: openai, connection: openAiConnection }
            : undefined,
      },
      providerConfigurations: {
        list: () => [
          {
            id: 'configured-openai',
            provider_definition_id: 'openai',
            provider_connection_definition_id: 'openai-api',
            models: [{ provider_model_id: 'gpt-existing', model_config_id: 'model-gpt-existing' }],
          },
        ],
        getByModelConfigId: () => undefined,
      },
      modelCatalog: {
        getModels: () => [],
        getModel: () => undefined,
        getInferenceEndpoints: () => [],
        hasCredential: () => false,
        getCredentialStatus: () => 'missing',
      },
      preferences: {
        read: () => ({ provider_preferences: [], model_preferences: [] }),
        setProviderVisibility: vi.fn(),
        setModelVisibility: vi.fn(),
      },
      providerAccounts: {
        list: () => [],
        hasCredential: () => false,
        getCredentialStatus: () => 'missing',
      },
      providerModelActivation: { registerDirectProviderModel: vi.fn() },
    });

    await expect(
      useCase.activateProviderModel('configured-openai', 'claude-foreign')
    ).rejects.toMatchObject({ code: 'model_picker.provider_model_not_found' });
  });
});
