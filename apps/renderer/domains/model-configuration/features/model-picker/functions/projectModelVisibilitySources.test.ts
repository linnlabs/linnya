import { describe, expect, it } from 'vitest';

import {
  filterModelVisibilityModels,
  filterUnadmittedModels,
  projectModelVisibilitySources,
} from './projectModelVisibilitySources';

describe('projectModelVisibilitySources', () => {
  it('固定正式 Provider、自定义模型顺序且不制造 Custom Provider', () => {
    const sources = projectModelVisibilitySources(
      {
        providers: [
          {
            configured_provider_id: 'configured-openai',
            provider_definition_id: 'openai',
            provider_connection_definition_id: 'openai-api',
            display_name: 'OpenAI',
            connection_display_name: 'OpenAI API',
            can_refresh_models: true,
            credential_kind: 'api_key',
            kind: 'direct',
            picker_enabled: true,
            credential_available: true,
            unadmitted_models: [],
            models: [],
          },
        ],
        unassigned_unadmitted_models: [],
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
      { customModels: '自定义模型', unassigned: '未归类的配置' }
    );

    expect(sources.map(source => [source.kind, source.displayName])).toEqual([
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
            can_refresh_models: true,
            credential_kind: 'api_key',
            kind: 'direct',
            picker_enabled: true,
            credential_available: true,
            unadmitted_models: [],
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
        unassigned_unadmitted_models: [],
      },
      { customModels: '自定义模型', unassigned: '未归类的配置' }
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
            can_refresh_models: true,
            credential_kind: 'api_key',
            kind: 'direct',
            picker_enabled: true,
            credential_available: true,
            unadmitted_models: [],
            models: [],
          },
          {
            configured_provider_id: 'configured-chatgpt',
            provider_definition_id: 'openai',
            provider_connection_definition_id: 'openai-chatgpt-subscription',
            display_name: 'OpenAI',
            connection_display_name: 'ChatGPT 订阅',
            can_refresh_models: true,
            credential_kind: 'provider_account',
            kind: 'direct',
            picker_enabled: true,
            credential_available: true,
            unadmitted_models: [],
            models: [],
          },
        ],
        custom_models: [],
        unassigned_unadmitted_models: [],
      },
      { customModels: '自定义模型', unassigned: '未归类的配置' }
    );

    expect(sources.map(source => source.displayName)).toEqual([
      'OpenAI · OpenAI API',
      'OpenAI · ChatGPT 订阅',
    ]);
  });

  it('配置无效的条目随所属来源投影；归属已不存在的单独成“未归类”来源，没有时不出现', () => {
    const invalid = (id: string, displayName: string) => ({
      model_config_id: id,
      display_name: displayName,
      reason_kind: 'multiple_routes' as const,
      reason: `用户模型 ${id} 必须声明唯一的推理 route`,
      repairable: false,
    });
    const snapshot = {
      providers: [],
      custom_models: [],
      custom_providers: [
        {
          provider_id: 'custom:Relay',
          provider_name: 'Relay',
          models: [],
          unadmitted_models: [
            invalid('relay-legacy', 'kimi-k3-legacy'),
            invalid('relay-qwen', 'qwen-plus'),
          ],
        },
      ],
      unassigned_unadmitted_models: [invalid('orphan', 'glm-5.3-old')],
    };
    const labels = { customModels: '自定义模型', unassigned: '未归类的配置' };
    const sources = projectModelVisibilitySources(snapshot, labels);
    expect(
      sources.map(source => [source.kind, source.displayName, source.unadmittedModels.length])
    ).toEqual([
      ['custom_provider', 'Relay', 2],
      ['unassigned', '未归类的配置', 1],
    ]);
    const [relay] = sources;
    if (!relay) throw new Error('fixture source missing');
    expect(filterUnadmittedModels(relay, 'QWEN').map(model => model.model_config_id)).toEqual([
      'relay-qwen',
    ]);
    expect(
      projectModelVisibilitySources({ ...snapshot, unassigned_unadmitted_models: [] }, labels).map(
        source => source.kind
      )
    ).toEqual(['custom_provider']);
  });
});
