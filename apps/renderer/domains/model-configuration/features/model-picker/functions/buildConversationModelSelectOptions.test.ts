import type { ModelPickerMaterializedModel } from '@app/schemas/model-picker';
import { describe, expect, it } from 'vitest';

import { buildConversationModelSelectOptions } from './buildConversationModelSelectOptions';

function model(
  id: string,
  displayName: string,
  runtimeAvailable = true
): ModelPickerMaterializedModel {
  return {
    materialized: true,
    model_config_id: id,
    provider_model_id: id,
    display_name: displayName,
    picker_enabled: true,
    runtime_available: runtimeAvailable,
    capabilities: ['chat'],
    image_input: true,
  };
}

describe('buildConversationModelSelectOptions', () => {
  it('按 Cloud、模型供应商、自定义模型投影设置中的对话模型菜单', () => {
    const options = buildConversationModelSelectOptions({
      snapshot: {
        cloud: { display_name: 'Linnya Cloud', models: [model('cloud', 'Cloud GPT')] },
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
            models: [model('provider-gpt', 'GPT-5.6')],
          },
        ],
        custom_models: [model('custom', '公司模型', false)],
      },
      labels: {
        providerGroup: '模型供应商',
        customGroup: '自定义模型',
        unavailable: '当前不可用',
      },
    });

    expect(options).toEqual([
      { isGroup: true, label: 'Linnya Cloud' },
      expect.objectContaining({ value: 'cloud', text: 'Cloud GPT' }),
      { isGroup: true, label: '模型供应商' },
      expect.objectContaining({
        text: 'OpenAI',
        shortcut: '1',
        children: [expect.objectContaining({ value: 'provider-gpt', text: 'GPT-5.6' })],
      }),
      { isGroup: true, label: '自定义模型' },
      expect.objectContaining({
        value: 'custom',
        text: '公司模型',
        disabled: true,
        disabledReason: '当前不可用',
      }),
    ]);
  });

  it('同一品牌只生成一个一级项，并只给跨 connection 同名模型加后缀', () => {
    const options = buildConversationModelSelectOptions({
      snapshot: {
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
            models: [model('api-gpt', 'GPT-5.6'), model('api-only', 'GPT API 专属')],
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
            models: [model('subscription-gpt', 'GPT-5.6')],
          },
        ],
        custom_models: [],
      },
      labels: {
        providerGroup: '模型供应商',
        customGroup: '自定义模型',
        unavailable: '当前不可用',
      },
    });

    expect(options).toEqual([
      { isGroup: true, label: '模型供应商' },
      expect.objectContaining({
        text: 'OpenAI',
        children: [
          expect.objectContaining({ text: 'GPT-5.6 · OpenAI API', value: 'api-gpt' }),
          expect.objectContaining({ text: 'GPT API 专属', value: 'api-only' }),
          expect.objectContaining({
            text: 'GPT-5.6 · ChatGPT 订阅',
            value: 'subscription-gpt',
          }),
        ],
      }),
    ]);
  });
});
