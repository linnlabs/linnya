import { buildModelInferenceRoute } from '@app/schemas/model-inference';
import { describe, expect, it } from 'vitest';

import { parseModelCatalogSnapshot } from './modelCatalogProjection';

describe('parseModelCatalogSnapshot', () => {
  it('把 HTTP wire 元数据投影为 Renderer 目录快照', () => {
    const inferenceRoute = buildModelInferenceRoute({
      profile_id: 'openai_compatible_chat',
      endpoint_id: 'openai-compatible',
      endpoint_model_id: 'demo-model',
      base_url: 'https://example.com/v1',
      auth_profile: 'bearer',
      context_window_tokens: 128_000,
      max_output_tokens: 16_384,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'required' },
    });

    expect(parseModelCatalogSnapshot({
      models: [{
        id: 'model-1',
        catalog_source: 'user',
        model_name: 'demo-model',
        display_name: 'Demo',
        capabilities: ['chat'],
        ui_visibility: ['chat'],
        inference_route: inferenceRoute,
        ignored_backend_field: true,
      }],
      task_defaults: { autocomplete: 'model-1' },
      cloud_models_ready: true,
      total: 1,
    })).toEqual({
      models: [{
        id: 'model-1',
        catalog_source: 'user',
        model_name: 'demo-model',
        display_name: 'Demo',
        capabilities: ['chat'],
        ui_visibility: ['chat'],
        inference_route: inferenceRoute,
      }],
      purposeDefaults: { autocomplete: 'model-1' },
      cloudModelsReady: true,
    });
  });

  it('拒绝旧数组响应，不在新 domain 内保留双 wire 合同', () => {
    expect(() => parseModelCatalogSnapshot([])).toThrow('模型目录响应不符合合同');
  });
});
