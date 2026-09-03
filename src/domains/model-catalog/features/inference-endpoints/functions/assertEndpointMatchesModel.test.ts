import { buildModelInferenceRoute } from '@app/schemas/model-inference';
import { describe, expect, it } from 'vitest';

import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';
import type { ModelConfig } from '../../../definitions/modelCatalog';
import { assertEndpointMatchesModel } from './assertEndpointMatchesModel';

describe('InferenceEndpoint 与模型 route 一致性', () => {
  it('允许正式产品 profile 复用同一个 AI SDK wire capability', () => {
    const endpoint: InferenceEndpoint = {
      id: 'chatgpt-endpoint',
      route_profile_id: 'chatgpt_codex_responses',
      endpoint_id: 'chatgpt:account',
      base_url: 'https://chatgpt.com/backend-api/codex',
      auth_profile: 'bearer',
      credential_reference: {
        kind: 'provider_account',
        account_id: 'chatgpt-subscription',
      },
    };
    const model: ModelConfig = {
      id: 'chatgpt-model',
      model_name: 'gpt-5.6-sol',
      catalog_source: 'user',
      inference_endpoint_id: endpoint.id,
      capabilities: ['chat', 'image_input'],
      ui_visibility: [],
      display_name: 'GPT-5.6 Sol',
      description: 'ChatGPT subscription model',
      billing_mode: 'byok',
      inference_route: buildModelInferenceRoute({
        profile_id: 'chatgpt_codex_responses',
        endpoint_id: endpoint.endpoint_id,
        endpoint_model_id: 'gpt-5.6-sol',
        base_url: endpoint.base_url,
        auth_profile: 'bearer',
        context_window_tokens: 372_000,
        max_output_tokens: 128_000,
        input_support: { user_image: true, tool_result_image: true },
        usage: { response_usage: 'provider_reported_optional' },
        continuation: { tool_replay: 'optional' },
      }),
    };

    expect(() => assertEndpointMatchesModel(endpoint, model)).not.toThrow();
  });
});
