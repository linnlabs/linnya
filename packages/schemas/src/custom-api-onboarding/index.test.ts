import { describe, expect, it } from 'vitest';

import { CustomApiModelRegistrationCommandSchema } from './index';

describe('CustomApiModelRegistrationCommandSchema', () => {
  it('允许公司内网 HTTP 并只保留用户可配置的业务字段', () => {
    expect(
      CustomApiModelRegistrationCommandSchema.parse({
        api_format: 'openai_responses',
        base_url: ' http://models.intranet:8080/v1/ ',
        api_key: 'secret-value',
        endpoint_model_id: 'company-gpt',
        context_window_tokens: 256_000,
        max_output_tokens: 16_384,
        supports_image_input: true,
      })
    ).toEqual({
      api_format: 'openai_responses',
      base_url: 'http://models.intranet:8080/v1',
      api_key: 'secret-value',
      endpoint_model_id: 'company-gpt',
      context_window_tokens: 256_000,
      max_output_tokens: 16_384,
      supports_image_input: true,
    });
  });

  it('拒绝内部 route 与伪造 Provider 字段', () => {
    expect(
      CustomApiModelRegistrationCommandSchema.safeParse({
        api_format: 'openai_compatible',
        base_url: 'https://api.example.com/v1',
        api_key: 'secret-value',
        endpoint_model_id: 'model',
        context_window_tokens: 64_000,
        max_output_tokens: 8_192,
        supports_image_input: false,
        provider: 'custom',
        route_profile_id: 'openai_compatible_chat',
      }).success
    ).toBe(false);
  });
});
