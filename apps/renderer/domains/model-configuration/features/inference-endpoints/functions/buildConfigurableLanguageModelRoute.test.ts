import { describe, expect, it } from 'vitest';
import {
  buildConfigurableLanguageModelRoute,
} from './buildConfigurableLanguageModelRoute';

describe('model configuration language route producer', () => {
  it('DeepSeek 直连只产出专用 AI SDK profile', () => {
    expect(
      buildConfigurableLanguageModelRoute({
        profile_id: 'deepseek_chat',
        endpoint_id: 'deepseek:endpoint-1',
        endpoint_model_id: 'deepseek-chat',
        base_url: 'https://api.deepseek.com/',
        auth_profile: 'bearer',
        context_window_tokens: 64_000,
        max_output_tokens: 8_192,
        supports_image_input: false,
      })
    ).toEqual({
      api_surface: 'openai_chat_completions',
      capability_id: 'ai-sdk:deepseek',
      endpoint_id: 'deepseek:endpoint-1',
      endpoint_model_id: 'deepseek-chat',
      base_url: 'https://api.deepseek.com',
      auth_profile: 'bearer',
      context_window_tokens: 64_000,
      max_output_tokens: 8_192,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    });
  });

  it('视觉能力同时开放用户图片与工具结果图片', () => {
    expect(
      buildConfigurableLanguageModelRoute({
        profile_id: 'anthropic_messages',
        endpoint_id: 'anthropic:endpoint-1',
        endpoint_model_id: 'claude-sonnet',
        base_url: 'https://api.anthropic.com/v1',
        auth_profile: 'api_key',
        context_window_tokens: 200_000,
        max_output_tokens: 8_192,
        supports_image_input: true,
      })
    ).toMatchObject({
      api_surface: 'anthropic_messages',
      capability_id: 'ai-sdk:anthropic-messages',
      endpoint_id: 'anthropic:endpoint-1',
      auth_profile: 'api_key',
      input_support: { user_image: true, tool_result_image: true },
      continuation: { tool_replay: 'optional' },
    });
  });

  it('OpenAI-compatible 图片模型只开放该协议真实支持的用户图片位置', () => {
    expect(
      buildConfigurableLanguageModelRoute({
        profile_id: 'openai_compatible_chat',
        endpoint_id: 'opencode-go:endpoint-1',
        endpoint_model_id: 'glm-5.3-flash',
        base_url: 'https://opencode.ai/zen/go/v1',
        auth_profile: 'bearer',
        context_window_tokens: 200_000,
        max_output_tokens: 32_000,
        supports_image_input: true,
      })
    ).toMatchObject({
      input_support: { user_image: true, tool_result_image: false },
    });
  });

});
