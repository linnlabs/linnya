import { buildModelInferenceRoute } from '@app/schemas/model-inference';
import { describe, expect, it } from 'vitest';

import type { ModelCatalogItem } from '../definitions/modelCatalog';
import { buildEditableLanguageModelUpdate } from './buildEditableLanguageModelUpdate';

function createModel(): ModelCatalogItem {
  return {
    id: 'custom-model',
    catalog_source: 'user',
    display_name: 'Before',
    model_name: 'provider-model',
    capabilities: ['chat'],
    inference_route: buildModelInferenceRoute({
      profile_id: 'openai_responses',
      endpoint_id: 'openai',
      endpoint_model_id: 'provider-model',
      base_url: 'https://example.com/v1',
      auth_profile: 'bearer',
      context_window_tokens: 32_768,
      max_output_tokens: 4_096,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    }),
  };
}

describe('buildEditableLanguageModelUpdate', () => {
  it('把用户编辑后的容量与模型身份原子写回 inference route', () => {
    const result = buildEditableLanguageModelUpdate(createModel(), {
      displayName: 'Updated model',
      modelName: 'provider-model-v2',
      contextWindowTokens: '128000',
      maxOutputTokens: '16384',
      supportsImageInput: true,
    });

    expect(result).toEqual({
      ok: true,
      command: {
        display_name: 'Updated model',
        model_name: 'provider-model-v2',
        capabilities: ['chat', 'image_input'],
        inference_route: {
          api_surface: 'openai_responses',
          capability_id: 'ai-sdk:openai-responses',
          endpoint_id: 'openai',
          endpoint_model_id: 'provider-model-v2',
          base_url: 'https://example.com/v1',
          auth_profile: 'bearer',
          context_window_tokens: 128_000,
          max_output_tokens: 16_384,
          input_support: { user_image: true, tool_result_image: true },
          usage: { response_usage: 'provider_reported_optional' },
          continuation: { tool_replay: 'optional' },
        },
      },
    });
  });

  it('Chat-only route 保留图片语义能力，但只开放用户图片位置', () => {
    const model = createModel();
    model.inference_route = buildModelInferenceRoute({
      profile_id: 'openai_compatible_chat',
      endpoint_id: 'openai-compatible',
      endpoint_model_id: 'provider-model',
      base_url: 'https://example.com/v1',
      auth_profile: 'bearer',
      context_window_tokens: 32_768,
      max_output_tokens: 4_096,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    });

    const result =
      buildEditableLanguageModelUpdate(model, {
        displayName: 'Updated model',
        modelName: 'provider-model',
        contextWindowTokens: '32768',
        maxOutputTokens: '4096',
        supportsImageInput: true,
      });
    expect(result).toMatchObject({
      ok: true,
      command: {
        capabilities: ['chat', 'image_input'],
        inference_route: {
          input_support: { user_image: true, tool_result_image: false },
        },
      },
    });
  });

  it('容量无效时不生成可提交 command', () => {
    expect(
      buildEditableLanguageModelUpdate(createModel(), {
        displayName: 'Updated model',
        modelName: 'provider-model',
        contextWindowTokens: '0',
        maxOutputTokens: '4096',
        supportsImageInput: false,
      })
    ).toEqual({ ok: false, issue: 'token_limits_invalid' });
  });

  it('缺少正式 language route 的模型不能伪造默认容量', () => {
    const model = createModel();
    delete model.inference_route;

    expect(
      buildEditableLanguageModelUpdate(model, {
        displayName: 'Updated model',
        modelName: 'provider-model',
        contextWindowTokens: '128000',
        maxOutputTokens: '16384',
        supportsImageInput: false,
      })
    ).toEqual({ ok: false, issue: 'inference_route_missing' });
  });
});
