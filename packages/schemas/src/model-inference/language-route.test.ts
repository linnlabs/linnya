import { describe, expect, it } from 'vitest';
import {
  buildModelInferenceRoute,
  DEFAULT_LANGUAGE_CONTEXT_WINDOW_TOKENS,
  DEFAULT_LANGUAGE_MAX_OUTPUT_TOKENS,
  LANGUAGE_INFERENCE_CAPABILITY_IDS,
  LANGUAGE_INFERENCE_ROUTE_PROFILES,
  ModelInferenceRouteSchema,
  projectLanguageInferenceImageInputSupport,
} from './language-route';

function routeFor(profile: (typeof LANGUAGE_INFERENCE_ROUTE_PROFILES)[number]) {
  return {
    api_surface: profile.api_surface,
    capability_id: profile.capability_id,
    endpoint_id: profile.id,
    endpoint_model_id: 'model-1',
    base_url: 'https://example.com/v1/',
    auth_profile: profile.auth_profiles[0],
    context_window_tokens: 128_000,
    max_output_tokens: 16_384,
    input_support: { user_image: false, tool_result_image: false },
    usage: { response_usage: 'provider_reported_optional' as const },
    continuation: { tool_replay: 'optional' as const },
  };
}

describe('ModelInferenceRouteSchema', () => {
  it('接纳所有已启用 route profile，并输出 canonical base URL', () => {
    for (const profile of LANGUAGE_INFERENCE_ROUTE_PROFILES) {
      const result = ModelInferenceRouteSchema.parse(routeFor(profile));
      expect(result.base_url).toBe('https://example.com/v1');
    }
  });

  it('只在容量字段真正缺失时规范化为 256K/16K canonical route', () => {
    const route = routeFor(LANGUAGE_INFERENCE_ROUTE_PROFILES[1]);
    const withoutTokenLimits = Object.fromEntries(Object.entries(route).filter(
      ([field]) => field !== 'context_window_tokens' && field !== 'max_output_tokens'
    ));

    expect(ModelInferenceRouteSchema.parse(withoutTokenLimits)).toMatchObject({
      context_window_tokens: DEFAULT_LANGUAGE_CONTEXT_WINDOW_TOKENS,
      max_output_tokens: DEFAULT_LANGUAGE_MAX_OUTPUT_TOKENS,
    });
  });

  it('保留显式模型容量，不用配置缺省收窄或扩大 route', () => {
    const route = routeFor(LANGUAGE_INFERENCE_ROUTE_PROFILES[1]);

    expect(
      ModelInferenceRouteSchema.parse({
        ...route,
        context_window_tokens: 1_000_000,
        max_output_tokens: 32_768,
      })
    ).toMatchObject({
      context_window_tokens: 1_000_000,
      max_output_tokens: 32_768,
    });
  });

  it.each([
    ['context_window_tokens', 0],
    ['context_window_tokens', -1],
    ['context_window_tokens', 1.5],
    ['context_window_tokens', Number.NaN],
    ['context_window_tokens', Number.MAX_SAFE_INTEGER + 1],
    ['max_output_tokens', 0],
    ['max_output_tokens', -1],
    ['max_output_tokens', 1.5],
    ['max_output_tokens', Number.NaN],
    ['max_output_tokens', Number.MAX_SAFE_INTEGER + 1],
  ] as const)('拒绝非法显式模型容量：%s=%s', (field, value) => {
    const route = routeFor(LANGUAGE_INFERENCE_ROUTE_PROFILES[1]);

    expect(ModelInferenceRouteSchema.safeParse({ ...route, [field]: value }).success).toBe(false);
  });

  it('拒绝 surface 与 capability 错配以及 legacy capability', () => {
    const openAiRoute = routeFor(LANGUAGE_INFERENCE_ROUTE_PROFILES[1]);
    expect(
      ModelInferenceRouteSchema.safeParse({
        ...openAiRoute,
        capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.ANTHROPIC_MESSAGES,
      }).success
    ).toBe(false);
    expect(
      ModelInferenceRouteSchema.safeParse({
        ...openAiRoute,
        capability_id: 'legacy:openai',
      }).success
    ).toBe(false);
  });

  it('拒绝缺少 continuation 或使用 profile 未批准的认证方式', () => {
    const route = routeFor(LANGUAGE_INFERENCE_ROUTE_PROFILES[1]);
    const withoutContinuation = Object.fromEntries(Object.entries(route).filter(
      ([field]) => field !== 'continuation'
    ));
    expect(ModelInferenceRouteSchema.safeParse(withoutContinuation).success).toBe(false);
    expect(ModelInferenceRouteSchema.safeParse({ ...route, auth_profile: 'none' }).success).toBe(
      false
    );
  });

  it('只允许经过 profile conformance 的 route 声明工具结果图片', () => {
    const chatRoute = routeFor(LANGUAGE_INFERENCE_ROUTE_PROFILES[1]);
    expect(
      ModelInferenceRouteSchema.safeParse({
        ...chatRoute,
        input_support: { user_image: true, tool_result_image: true },
      }).success
    ).toBe(false);

    const responsesRoute = routeFor(LANGUAGE_INFERENCE_ROUTE_PROFILES[3]);
    expect(
      ModelInferenceRouteSchema.safeParse({
        ...responsesRoute,
        input_support: { user_image: true, tool_result_image: true },
      }).success
    ).toBe(true);
  });

  it('按来源投影模型图片能力，不把 Chat 的用户图片能力一并关闭', () => {
    expect(projectLanguageInferenceImageInputSupport('openai_compatible_chat', true)).toEqual({
      user_image: true,
      tool_result_image: false,
    });
    expect(projectLanguageInferenceImageInputSupport('openai_responses', true)).toEqual({
      user_image: true,
      tool_result_image: true,
    });
    expect(projectLanguageInferenceImageInputSupport('ollama_chat', true)).toEqual({
      user_image: true,
      tool_result_image: true,
    });
    expect(projectLanguageInferenceImageInputSupport('deepseek_chat', true)).toEqual({
      user_image: true,
      tool_result_image: true,
    });
    expect(projectLanguageInferenceImageInputSupport('deepseek_chat', false)).toEqual({
      user_image: false,
      tool_result_image: false,
    });
    expect(projectLanguageInferenceImageInputSupport('openai_responses', false)).toEqual({
      user_image: false,
      tool_result_image: false,
    });
  });

  it('配置生产端只选择 profile，由共享 builder 生成 surface/capability 配对', () => {
    const route = buildModelInferenceRoute({
      profile_id: 'openai_compatible_chat',
      endpoint_id: 'ollama',
      endpoint_model_id: 'qwen3',
      base_url: 'http://127.0.0.1:11434/v1',
      auth_profile: 'none',
      context_window_tokens: 32_768,
      max_output_tokens: 4_096,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'unavailable' },
    });

    expect(route).toMatchObject({
      api_surface: 'openai_chat_completions',
      capability_id: 'ai-sdk:openai-compatible',
      auth_profile: 'none',
    });
  });

  it('共享 builder 在配置端省略容量时仍输出完整 canonical route', () => {
    const route = buildModelInferenceRoute({
      profile_id: 'openai_compatible_chat',
      endpoint_id: 'internal-gateway',
      endpoint_model_id: 'company-model',
      base_url: 'http://llm.intranet/v1',
      auth_profile: 'bearer',
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    });

    expect(route).toMatchObject({
      context_window_tokens: DEFAULT_LANGUAGE_CONTEXT_WINDOW_TOKENS,
      max_output_tokens: DEFAULT_LANGUAGE_MAX_OUTPUT_TOKENS,
    });
  });

  it.each([
    ['deepseek_chat', 'openai_chat_completions', 'ai-sdk:deepseek', 'bearer'],
    ['mistral_chat', 'openai_chat_completions', 'ai-sdk:mistral', 'bearer'],
    ['xai_responses', 'openai_responses', 'ai-sdk:xai-responses', 'bearer'],
    ['groq_chat', 'openai_chat_completions', 'ai-sdk:groq', 'bearer'],
    ['cerebras_chat', 'openai_chat_completions', 'ai-sdk:cerebras', 'bearer'],
    ['openrouter_chat', 'openai_chat_completions', 'ai-sdk:openrouter', 'bearer'],
    ['fireworks_chat', 'openai_chat_completions', 'ai-sdk:fireworks', 'bearer'],
    ['togetherai_chat', 'openai_chat_completions', 'ai-sdk:togetherai', 'bearer'],
    ['deepinfra_chat', 'openai_chat_completions', 'ai-sdk:deepinfra', 'bearer'],
    ['cohere_chat', 'cohere_chat', 'ai-sdk:cohere', 'bearer'],
    ['zai_chat', 'openai_chat_completions', 'ai-sdk:zai', 'bearer'],
    ['ollama_chat', 'ollama_chat', 'ai-sdk:ollama', 'bearer'],
    ['minimax_chat', 'anthropic_messages', 'ai-sdk:minimax', 'api_key'],
    ['moonshot_chat', 'openai_chat_completions', 'ai-sdk:moonshotai', 'bearer'],
    ['alibaba_chat', 'openai_chat_completions', 'ai-sdk:alibaba', 'bearer'],
  ] as const)(
    '为正式厂商 profile 固定专用 capability：%s',
    (profileId, apiSurface, capabilityId, authProfile) => {
      const route = buildModelInferenceRoute({
        profile_id: profileId,
        endpoint_id: profileId,
        endpoint_model_id: 'model-1',
        base_url: 'https://example.com/v1',
        auth_profile: authProfile,
        context_window_tokens: 128_000,
        max_output_tokens: 16_384,
        input_support: { user_image: false, tool_result_image: false },
        usage: { response_usage: 'provider_reported_optional' },
        continuation: { tool_replay: 'required' },
      });

      expect(route).toMatchObject({
        api_surface: apiSurface,
        capability_id: capabilityId,
        auth_profile: authProfile,
      });
    }
  );
});
