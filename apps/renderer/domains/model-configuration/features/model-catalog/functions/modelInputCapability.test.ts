import { describe, expect, it } from 'vitest';

import {
  buildChatModelCapabilities,
  modelAcceptsUserImageInput,
  setImageInputCapability,
} from './modelInputCapability';

describe('settings model image input capability', () => {
  it('builds explicit capabilities for unchecked and checked chat model forms', () => {
    expect(buildChatModelCapabilities(false)).toEqual(['chat']);
    expect(buildChatModelCapabilities(true)).toEqual(['chat', 'image_input']);
  });

  it('toggles image_input without dropping open extension capabilities', () => {
    const existing = ['chat', 'plugin.custom', 'image_input', 'plugin.custom'];

    expect(setImageInputCapability(existing, false)).toEqual(['chat', 'plugin.custom']);
    expect(setImageInputCapability(existing, true)).toEqual([
      'chat',
      'plugin.custom',
      'image_input',
    ]);
  });

  it('用户附件准入同时要求模型语义能力与 user_image route 位置', () => {
    expect(modelAcceptsUserImageInput({
      capabilities: ['chat', 'image_input'],
      inference_route: {
        api_surface: 'openai_chat_completions',
        capability_id: 'ai-sdk:openai-compatible',
        endpoint_id: 'opencode-go',
        endpoint_model_id: 'glm-5.3-flash',
        base_url: 'https://opencode.ai/zen/go/v1',
        auth_profile: 'bearer',
        context_window_tokens: 200_000,
        max_output_tokens: 32_000,
        input_support: { user_image: true, tool_result_image: false },
        usage: { response_usage: 'provider_reported_optional' },
        continuation: { tool_replay: 'optional' },
      },
    })).toBe(true);
    expect(modelAcceptsUserImageInput({
      capabilities: ['chat'],
      inference_route: undefined,
    })).toBe(false);
  });
});
