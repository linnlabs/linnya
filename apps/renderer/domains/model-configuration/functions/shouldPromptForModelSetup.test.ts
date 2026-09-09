import { describe, expect, it } from 'vitest';
import { shouldPromptForModelSetup } from './shouldPromptForModelSetup';

describe('shouldPromptForModelSetup', () => {
  it('snapshot 未加载或输入不可用时不遮挡输入区', () => {
    expect(shouldPromptForModelSetup(null, false)).toBe(false);
    expect(shouldPromptForModelSetup({ providers: [], custom_models: [] }, true)).toBe(false);
  });

  it('没有配置 Provider 且没有自定义模型时提示配置', () => {
    expect(shouldPromptForModelSetup({ providers: [], custom_models: [] }, false)).toBe(true);
    expect(
      shouldPromptForModelSetup(
        {
          providers: [],
          custom_models: [
            {
              materialized: true,
              model_config_id: 'custom-model',
              display_name: 'Custom model',
              picker_enabled: true,
              runtime_available: true,
              capabilities: ['chat'],
              image_input: false,
            },
          ],
        },
        false
      )
    ).toBe(false);
  });

  it('已有 Provider 时不再提示，即使没有自定义模型', () => {
    expect(
      shouldPromptForModelSetup(
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
              models: [],
            },
          ],
          custom_models: [],
        },
        false
      )
    ).toBe(false);
  });
});
