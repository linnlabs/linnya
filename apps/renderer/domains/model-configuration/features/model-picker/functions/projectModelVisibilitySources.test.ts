import { describe, expect, it } from 'vitest';

import {
  filterModelVisibilityModels,
  projectModelVisibilitySources,
} from './projectModelVisibilitySources';

describe('projectModelVisibilitySources', () => {
  it('固定 Cloud、正式 Provider、自定义模型顺序且不制造 Custom Provider', () => {
    const sources = projectModelVisibilitySources(
      {
        cloud: { display_name: 'Linnya Cloud', models: [] },
        providers: [
          {
            configured_provider_id: 'configured-openai',
            provider_definition_id: 'openai',
            provider_connection_definition_id: 'openai-api',
            display_name: 'OpenAI',
            connection_display_name: 'OpenAI API',
            kind: 'direct',
            picker_enabled: true,
            credential_available: true,
            models: [],
          },
        ],
        custom_models: [
          {
            materialized: true,
            model_config_id: 'custom-1',
            display_name: '公司模型',
            picker_enabled: true,
            runtime_available: true,
            capabilities: ['chat'],
            image_input: true,
          },
        ],
      },
      '自定义模型'
    );

    expect(sources.map(source => [source.kind, source.displayName])).toEqual([
      ['cloud', 'Linnya Cloud'],
      ['provider', 'OpenAI'],
      ['custom', '自定义模型'],
    ]);
  });

  it('全目录搜索包含未激活模型', () => {
    const source = projectModelVisibilitySources(
      {
        providers: [
          {
            configured_provider_id: 'configured-openai',
            provider_definition_id: 'openai',
            provider_connection_definition_id: 'openai-api',
            display_name: 'OpenAI',
            connection_display_name: 'OpenAI API',
            kind: 'direct',
            picker_enabled: true,
            credential_available: true,
            models: [
              {
                materialized: true,
                model_config_id: 'model-gpt-active',
                provider_model_id: 'gpt-active',
                display_name: 'GPT Active',
                picker_enabled: true,
                runtime_available: true,
                capabilities: ['chat'],
                image_input: true,
              },
              {
                materialized: false,
                provider_model_id: 'gpt-catalog',
                display_name: 'GPT Catalog',
                picker_enabled: false,
                runtime_available: false,
                capabilities: ['chat'],
                image_input: true,
              },
            ],
          },
        ],
        custom_models: [],
      },
      '自定义模型'
    )[0];
    if (!source) throw new Error('测试来源缺失');

    expect(filterModelVisibilityModels(source, 'catalog').map(model => model.display_name)).toEqual(
      ['GPT Catalog']
    );
  });

  it('同一品牌配置多个 connection 时在模型管理中明确标注接入方式', () => {
    const sources = projectModelVisibilitySources(
      {
        providers: [
          {
            configured_provider_id: 'configured-openai-api',
            provider_definition_id: 'openai',
            provider_connection_definition_id: 'openai-api',
            display_name: 'OpenAI',
            connection_display_name: 'OpenAI API',
            kind: 'direct',
            picker_enabled: true,
            credential_available: true,
            models: [],
          },
          {
            configured_provider_id: 'configured-chatgpt',
            provider_definition_id: 'openai',
            provider_connection_definition_id: 'openai-chatgpt-subscription',
            display_name: 'OpenAI',
            connection_display_name: 'ChatGPT 订阅',
            kind: 'direct',
            picker_enabled: true,
            credential_available: true,
            models: [],
          },
        ],
        custom_models: [],
      },
      '自定义模型'
    );

    expect(sources.map(source => source.displayName)).toEqual([
      'OpenAI · OpenAI API',
      'OpenAI · ChatGPT 订阅',
    ]);
  });
});
