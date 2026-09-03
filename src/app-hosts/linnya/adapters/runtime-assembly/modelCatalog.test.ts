import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from 'src/domains/model-catalog';

vi.mock('src/domains/model-catalog', () => ({
  modelCatalog: {
    getModel: vi.fn(),
    getModelsByCapability: vi.fn(),
    getModelsByUIVisibility: vi.fn(),
  },
}));

import { modelCatalog } from 'src/domains/model-catalog';
import { defaultModelCatalog, toRuntimeModelCatalogEntry } from './modelCatalog';

function model(overrides: Partial<ModelConfig> = {}): ModelConfig {
  const modelName = overrides.model_name ?? 'provider-model-1';
  const endpointId = overrides.inference_route?.endpoint_id ?? 'custom-endpoint';
  const baseUrl = overrides.inference_route?.base_url ?? 'https://models.example.com/v1';

  return {
    id: 'model-1',
    model_name: modelName,
    catalog_source: 'user',
    capabilities: ['chat', 'image_input'],
    ui_visibility: ['user'],
    display_name: 'Model 1',
    description: 'catalog test model',
    inference_route: {
      api_surface: 'openai_chat_completions',
      capability_id: 'ai-sdk:openai-chat',
      endpoint_id: endpointId,
      endpoint_model_id: modelName,
      base_url: baseUrl,
      auth_profile: 'bearer',
      context_window_tokens: 16_384,
      max_output_tokens: 4_096,
      input_support: { user_image: true, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    },
    reasoning: {
      supported_efforts: ['low'],
      default_effort: 'low',
    },
    ...overrides,
  };
}

describe('runtime model catalog adapter 输入能力', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('保留模型配置，并直接使用显式 inference route 的输入能力', () => {
    const config = model();

    expect(toRuntimeModelCatalogEntry(config)).toEqual({
      ...config,
      adapter_input_support: {
        user_image: true,
        tool_result_image: false,
      },
    });
  });

  it('所有 catalog 查询都经过同一个转换边界', () => {
    const first = model();
    const second = model({ id: 'model-2', model_name: 'provider-model-2' });
    vi.mocked(modelCatalog.getModel).mockReturnValue(first);
    vi.mocked(modelCatalog.getModelsByCapability).mockReturnValue([first, second]);
    vi.mocked(modelCatalog.getModelsByUIVisibility).mockReturnValue([second]);

    expect(defaultModelCatalog.getModelById(first.id)?.adapter_input_support).toEqual({
      user_image: true,
      tool_result_image: false,
    });
    expect(defaultModelCatalog.getModelsByCapability('chat')).toHaveLength(2);
    expect(defaultModelCatalog.getModelsByUIVisibility('user')).toHaveLength(1);
  });

  it('找不到模型时返回 undefined', () => {
    vi.mocked(modelCatalog.getModel).mockReturnValue(undefined);

    expect(defaultModelCatalog.getModelById('missing')).toBeUndefined();
  });
});
