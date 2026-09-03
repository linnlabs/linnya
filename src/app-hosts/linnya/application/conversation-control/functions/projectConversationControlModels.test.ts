import { describe, expect, it } from 'vitest';
import type { ModelConfig } from 'src/domains/model-catalog';
import { projectConversationControlModels } from './projectConversationControlModels';

function chatModel(id: string, displayName: string): ModelConfig {
  return {
    id,
    model_name: `${id}-upstream`,
    catalog_source: 'account',
    credential_reference: { kind: 'provider_account', account_id: id },
    capabilities: ['chat'],
    ui_visibility: ['chat'],
    display_name: displayName,
    description: '',
    inference_route: {
      api_surface: 'openai_responses',
      capability_id: 'ai-sdk:openai-responses',
      endpoint_id: `${id}-endpoint`,
      endpoint_model_id: `${id}-upstream`,
      base_url: 'https://example.com/v1',
      auth_profile: 'bearer',
      input_support: { user_image: true, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
      context_window_tokens: 128_000,
      max_output_tokens: 16_384,
    },
    reasoning: {
      supported_efforts: ['low', 'medium', 'high'],
      default_effort: 'medium',
    },
  };
}

function imageModel(): ModelConfig {
  return {
    id: 'image-model',
    model_name: 'image-upstream',
    catalog_source: 'cloud',
    credential_reference: { kind: 'host_managed', credential_id: 'linnya-cloud' },
    capabilities: ['image_generation'],
    ui_visibility: ['image_generation'],
    display_name: 'Image Model',
    description: '',
    image_generation_route: {
      api_surface: 'openai_images_generations',
      capability_id: 'ai-sdk:openai-compatible-image-generation',
      endpoint_id: 'image-endpoint',
      endpoint_model_id: 'image-upstream',
      base_url: 'https://example.com/v1',
      auth_profile: 'bearer',
      response_format: 'b64_json',
      max_images_per_call: 1,
    },
  };
}

describe('projectConversationControlModels', () => {
  it('按用途投影安全字段，并把可用模型稳定排在不可用模型前', () => {
    const result = projectConversationControlModels(
      [chatModel('missing-account', 'A Missing'), imageModel(), chatModel('ready-account', 'Z Ready')],
      {
        inferenceEndpoints: [],
        hasModelCredential: modelId => modelId === 'image-model',
        hasProviderAccountCredential: accountId => accountId === 'ready-account',
      },
    );

    expect(result.chat).toEqual([
      {
        model_config_id: 'ready-account',
        model_name: 'ready-account-upstream',
        display_name: 'Z Ready',
        catalog_source: 'account',
        available: true,
        input_support: { user_image: true, tool_result_image: false },
        reasoning: {
          supported_efforts: ['low', 'medium', 'high'],
          default_effort: 'medium',
        },
      },
      {
        model_config_id: 'missing-account',
        model_name: 'missing-account-upstream',
        display_name: 'A Missing',
        catalog_source: 'account',
        available: false,
        unavailable_reason: 'credential_missing',
        input_support: { user_image: true, tool_result_image: false },
        reasoning: {
          supported_efforts: ['low', 'medium', 'high'],
          default_effort: 'medium',
        },
      },
    ]);
    expect(result.imageGeneration).toEqual([{
      model_config_id: 'image-model',
      model_name: 'image-upstream',
      display_name: 'Image Model',
      catalog_source: 'cloud',
      available: true,
    }]);
  });
});
