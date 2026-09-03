import { describe, expect, it } from 'vitest';
import type { ModelConfig } from 'src/domains/model-catalog';

import {
  evaluateModelRuntimeAvailability,
  isModelRuntimeAvailable,
} from './evaluateModelRuntimeAvailability';

function chatModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'model-1',
    model_name: 'model-1-upstream',
    catalog_source: 'account',
    credential_reference: { kind: 'provider_account', account_id: 'account-1' },
    capabilities: ['chat'],
    ui_visibility: ['chat'],
    display_name: 'Model 1',
    description: '',
    inference_route: {
      api_surface: 'openai_responses',
      capability_id: 'ai-sdk:openai-responses',
      endpoint_id: 'endpoint-1',
      endpoint_model_id: 'model-1-upstream',
      base_url: 'https://example.com/v1',
      auth_profile: 'bearer',
      input_support: { user_image: true, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
      context_window_tokens: 128_000,
      max_output_tokens: 16_384,
    },
    ...overrides,
  };
}

const baseContext = {
  inferenceEndpoints: [],
  hasModelCredential: () => true,
  hasProviderAccountCredential: () => true,
} as const;

describe('evaluateModelRuntimeAvailability', () => {
  it('只有正式 route 与账号凭据同时存在时才接纳账号模型', () => {
    const model = chatModel();
    expect(
      evaluateModelRuntimeAvailability({ model, capability: 'chat', context: baseContext }),
    ).toEqual({ available: true });
    expect(
      evaluateModelRuntimeAvailability({
        model,
        capability: 'chat',
        context: { ...baseContext, hasProviderAccountCredential: () => false },
      }),
    ).toEqual({ available: false, reason: 'credential_missing' });
  });

  it('区分能力缺失与正式 route 缺失', () => {
    const model = chatModel({ inference_route: undefined });
    expect(
      evaluateModelRuntimeAvailability({ model, capability: 'chat', context: baseContext }),
    ).toEqual({ available: false, reason: 'route_missing' });
    expect(
      evaluateModelRuntimeAvailability({
        model,
        capability: 'image_generation',
        context: baseContext,
      }),
    ).toEqual({ available: false, reason: 'capability_missing' });
  });

  it('使用 inference endpoint 的真实 credential 状态', () => {
    const model = chatModel({
      catalog_source: 'user',
      credential_reference: undefined,
      inference_endpoint_id: 'custom-endpoint',
    });
    const endpoint = {
      id: 'custom-endpoint',
      route_profile_id: 'openai_responses' as const,
      endpoint_id: 'custom-endpoint',
      base_url: 'https://example.com/v1',
      auth_profile: 'bearer' as const,
      credential_reference: { kind: 'stored_secret' as const, credential_id: 'secret-1' },
      credential_status: 'missing' as const,
    };
    expect(
      evaluateModelRuntimeAvailability({
        model,
        capability: 'chat',
        context: { ...baseContext, inferenceEndpoints: [endpoint] },
      }),
    ).toEqual({ available: false, reason: 'credential_missing' });
  });

  it('Model Picker 的聚合标记与具体用途共享同一判定', () => {
    const model = chatModel();
    expect(isModelRuntimeAvailable(model, baseContext)).toBe(true);
    expect(
      isModelRuntimeAvailable(model, {
        ...baseContext,
        hasProviderAccountCredential: () => false,
      }),
    ).toBe(false);
  });
});
