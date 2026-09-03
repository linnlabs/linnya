import { describe, expect, it } from 'vitest';

import {
  isConfigurableLanguageRouteProfileId,
  readConfigurableLanguageRouteImageInputSupport,
  resolveConfigurableLanguageProtocolLabelKey,
} from './customLanguageApiFormats';

describe('configurable language route presentation', () => {
  it('模型详情允许编辑所有正式 language route，但拒绝 mock', () => {
    expect(isConfigurableLanguageRouteProfileId('openai_responses')).toBe(true);
    expect(isConfigurableLanguageRouteProfileId('deepseek_chat')).toBe(true);
    expect(isConfigurableLanguageRouteProfileId('google_generative_ai')).toBe(true);
    expect(isConfigurableLanguageRouteProfileId('mock')).toBe(false);
  });

  it('只展示协议类别，不从 route profile 反猜 Provider', () => {
    expect(resolveConfigurableLanguageProtocolLabelKey('openai_responses')).toBe(
      'settings.addModel.compatibility.openaiResponses'
    );
    expect(resolveConfigurableLanguageProtocolLabelKey('anthropic_messages')).toBe(
      'settings.addModel.compatibility.anthropicCompatible'
    );
    expect(resolveConfigurableLanguageProtocolLabelKey('deepseek_chat')).toBe(
      'settings.addModel.compatibility.openaiCompatible'
    );
  });

  it('分别呈现 route 支持的用户图片与工具结果图片位置', () => {
    expect(readConfigurableLanguageRouteImageInputSupport('openai_responses')).toEqual({
      user_image: true,
      tool_result_image: true,
    });
    expect(readConfigurableLanguageRouteImageInputSupport('openai_compatible_chat')).toEqual({
      user_image: true,
      tool_result_image: false,
    });
  });
});
