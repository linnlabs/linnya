import type { ModelPickerMaterializedModel, ModelPickerSnapshot } from '@app/schemas/model-picker';
import { describe, expect, it } from 'vitest';

import { MANAGE_CONVERSATION_MODELS_VALUE } from '../definitions/conversationModelMenu';
import { projectConversationModelMenu } from './projectConversationModelMenu';

function model(id: string, displayName: string): ModelPickerMaterializedModel {
  return {
    materialized: true,
    model_config_id: id,
    provider_model_id: id,
    display_name: displayName,
    picker_enabled: true,
    runtime_available: true,
    capabilities: ['chat'],
    image_input: true,
  };
}

const labels = {
  custom: '自定义模型',
  provider: '模型供应商',
  current: '当前模型',
  manage: '管理模型…',
  imageUnsupported: '不支持图片',
  unavailable: '当前不可用',
  reasoning: '思考程度',
  reasoningEfforts: {
    off: '关闭',
    minimal: '最低',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '超高',
  },
};

const noReasoning = {
  currentEffort: null,
  supportedEffortsByModelId: {},
} as const;

describe('projectConversationModelMenu', () => {
  it('Cloud 和自定义模型直接展开，正式 Provider 只占一个父菜单项', () => {
    const snapshot: ModelPickerSnapshot = {
      cloud: { display_name: 'Linnya Cloud', models: [model('cloud-gpt', 'GPT Cloud')] },
      providers: [
        {
          configured_provider_id: 'provider-openai',
          provider_definition_id: 'openai',
          provider_connection_definition_id: 'openai-api',
          connection_display_name: 'API',
          display_name: 'OpenAI',
          kind: 'direct',
          picker_enabled: true,
          credential_available: true,
          models: [model('gpt-5.6', 'GPT-5.6')],
        },
      ],
      custom_models: [model('intranet', '公司模型')],
    };

    const result = projectConversationModelMenu({
      snapshot,
      currentModel: null,
      hasImageDrafts: false,
      labels,
      reasoning: noReasoning,
    });

    expect(result.options).toEqual([
      { isGroup: true, label: 'Linnya Cloud' },
      expect.objectContaining({ value: 'cloud-gpt', text: 'GPT Cloud' }),
      { isGroup: true, label: '模型供应商' },
      expect.objectContaining({
        text: 'OpenAI',
        shortcut: '1',
        children: [expect.objectContaining({ value: 'gpt-5.6', text: 'GPT-5.6' })],
      }),
      { isGroup: true, label: '自定义模型' },
      expect.objectContaining({ value: 'intranet', text: '公司模型' }),
      { isSeparator: true },
      { value: MANAGE_CONVERSATION_MODELS_VALUE, text: '管理模型…' },
    ]);
  });

  it('把已隐藏的当前模型保留在真实 Provider 来源中，不生成第四个来源分组', () => {
    const snapshot: ModelPickerSnapshot = {
      providers: [
        {
          configured_provider_id: 'hidden',
          provider_definition_id: 'openai',
          provider_connection_definition_id: 'openai-api',
          connection_display_name: 'API',
          display_name: '隐藏 Provider',
          kind: 'direct',
          picker_enabled: false,
          credential_available: true,
          models: [model('hidden-model', '隐藏模型'), model('other-model', '其他模型')],
        },
      ],
      custom_models: [],
    };
    const result = projectConversationModelMenu({
      snapshot,
      currentModel: { id: 'hidden-model', displayName: '隐藏模型', imageInput: true },
      hasImageDrafts: false,
      labels,
      reasoning: noReasoning,
    });

    expect(result.options.slice(0, 2)).toEqual([
      { isGroup: true, label: '模型供应商' },
      expect.objectContaining({
        text: '隐藏 Provider',
        children: [expect.objectContaining({ value: 'hidden-model', text: '隐藏模型' })],
      }),
    ]);
    expect(result.options.some(option => option.label === '当前模型')).toBe(false);
  });

  it('来源已经不存在的历史当前模型只保留临时项，不伪造第四个来源分组', () => {
    const result = projectConversationModelMenu({
      snapshot: { providers: [], custom_models: [] },
      currentModel: { id: 'removed-model', displayName: '历史模型', imageInput: true },
      hasImageDrafts: false,
      labels,
      reasoning: noReasoning,
    });

    expect(result.options.slice(0, 2)).toEqual([
      expect.objectContaining({
        value: 'removed-model',
        text: '历史模型',
        shortcut: '当前模型',
      }),
      { isSeparator: true },
    ]);
    expect(result.options.some(option => option.isGroup)).toBe(false);
  });

  it('有图片草稿时禁用非视觉模型', () => {
    const snapshot: ModelPickerSnapshot = {
      providers: [
        {
          configured_provider_id: 'provider-openai',
          provider_definition_id: 'openai',
          provider_connection_definition_id: 'openai-api',
          connection_display_name: 'API',
          display_name: 'OpenAI',
          kind: 'direct',
          picker_enabled: true,
          credential_available: true,
          models: [{ ...model('gpt-text', 'GPT Text'), image_input: false }],
        },
      ],
      custom_models: [],
    };
    const result = projectConversationModelMenu({
      snapshot,
      currentModel: null,
      hasImageDrafts: true,
      labels,
      reasoning: noReasoning,
    });

    expect(result.options).toContainEqual(
      expect.objectContaining({
        text: 'OpenAI',
        children: [
          expect.objectContaining({
            value: 'gpt-text',
            disabled: true,
            disabledReason: '不支持图片',
          }),
        ],
      })
    );
  });

  it('把支持的思考强度放进模型子菜单，并在当前模型名称中展示有效强度', () => {
    const snapshot: ModelPickerSnapshot = {
      providers: [
        {
          configured_provider_id: 'provider-openai',
          provider_definition_id: 'openai',
          provider_connection_definition_id: 'openai-api',
          connection_display_name: 'API',
          display_name: 'OpenAI',
          kind: 'direct',
          picker_enabled: true,
          credential_available: true,
          models: [model('gpt-5.6', 'GPT-5.6')],
        },
      ],
      custom_models: [],
    };

    const result = projectConversationModelMenu({
      snapshot,
      currentModel: { id: 'gpt-5.6', displayName: 'GPT-5.6', imageInput: true },
      hasImageDrafts: false,
      labels,
      reasoning: {
        currentEffort: 'high',
        supportedEffortsByModelId: { 'gpt-5.6': ['low', 'high'] },
      },
    });

    expect(result.options).toContainEqual(
      expect.objectContaining({
        text: 'OpenAI',
        children: [
          expect.objectContaining({
            value: 'gpt-5.6',
            text: 'GPT-5.6 · 高',
            allowDirectSelect: true,
            children: [
              { isGroup: true, label: '思考程度' },
              { value: 'gpt-5.6::reasoning::low', text: '低', selected: false },
              { value: 'gpt-5.6::reasoning::high', text: '高', selected: true },
            ],
          }),
        ],
      })
    );
  });
});
