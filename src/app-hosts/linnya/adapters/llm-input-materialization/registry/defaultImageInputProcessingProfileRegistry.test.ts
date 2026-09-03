import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGE_INFERENCE_CAPABILITY_IDS } from '@app/schemas/model-inference';
import type { ModelConfig } from 'src/domains/model-catalog';

const getModel = vi.hoisted(() => vi.fn());

vi.mock('src/domains/model-catalog', () => ({
  modelCatalog: { getModel },
}));

import { ANTHROPIC_MESSAGES_IMAGE_INPUT_PROFILE } from './anthropicMessagesImageInputProfile';
import { CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE } from './chatCompletionsImageInputProfile';
import { OPENAI_RESPONSES_IMAGE_INPUT_PROFILE } from './openAiResponsesImageInputProfile';
import { defaultImageInputProcessingProfileRegistry } from './defaultImageInputProcessingProfileRegistry';

type ImageRoute =
  | 'openai-chat'
  | 'openai-compatible'
  | 'openai-responses'
  | 'anthropic';

function readImageRoute(value: string): ImageRoute | undefined {
  switch (value) {
    case 'openai-chat':
    case 'openai-compatible':
    case 'openai-responses':
    case 'anthropic':
      return value;
    default:
      return undefined;
  }
}

function model(route: ImageRoute): ModelConfig {
  const routeContract = route === 'openai-responses'
    ? {
        api_surface: 'openai_responses' as const,
        capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENAI_RESPONSES,
        auth_profile: 'bearer' as const,
      }
    : route === 'anthropic'
      ? {
          api_surface: 'anthropic_messages' as const,
          capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.ANTHROPIC_MESSAGES,
          auth_profile: 'api_key' as const,
        }
      : {
          api_surface: 'openai_chat_completions' as const,
          capability_id: route === 'openai-chat'
            ? LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENAI_CHAT
            : LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENAI_COMPATIBLE_CHAT,
          auth_profile: 'bearer' as const,
        };
  return {
    id: `model-${route}`,
    model_name: `provider-${route}`,
    catalog_source: 'default',
    capabilities: ['chat', 'image_input'],
    ui_visibility: ['chat'],
    display_name: route,
    description: `${route} profile binding`,
    inference_route: {
      ...routeContract,
      endpoint_id: 'fixture-provider',
      endpoint_model_id: `provider-${route}`,
      base_url: 'https://models.example.com/v1',
      context_window_tokens: 16_384,
      max_output_tokens: 4_096,
      input_support: { user_image: true, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    },
  };
}

describe('default image input processing profile registry', () => {
  beforeEach(() => {
    getModel.mockReset();
    getModel.mockImplementation((id: string) => {
      const route = readImageRoute(id.replace('model-', ''));
      return route ? model(route) : undefined;
    });
  });

  it.each(['openai-chat', 'openai-compatible'] as const)(
    '%s 复用已验收的 Chat Completions 图片 profile',
    route => {
      expect(defaultImageInputProcessingProfileRegistry.resolveForModel(`model-${route}`)).toBe(
        CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE
      );
    }
  );

  it('Responses 与 Anthropic 保持各自独立的图片 profile', () => {
    expect(defaultImageInputProcessingProfileRegistry.resolveForModel('model-openai-responses')).toBe(
      OPENAI_RESPONSES_IMAGE_INPUT_PROFILE
    );
    expect(defaultImageInputProcessingProfileRegistry.resolveForModel('model-anthropic')).toBe(
      ANTHROPIC_MESSAGES_IMAGE_INPUT_PROFILE
    );
  });

  it('没有显式注册的 route 不获得图片处理能力', () => {
    expect(defaultImageInputProcessingProfileRegistry.resolveForModel('model-unknown')).toBeUndefined();
  });
});
