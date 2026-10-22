import type { CanonicalInferenceEvent } from '@linnlabs/linnkit/ports';
import { createAiSdkLanguageModelRegistry } from '@linnlabs/linnkit-provider-ai-sdk';
import { describe, expect, it } from 'vitest';
import type { InferenceCapabilityInvocation, ResolvedInferenceAttemptRoute } from '../../../definitions/inferenceCapability';
import { createLinnyaAiSdkInferenceCapability } from '../../ai-sdk-language-composition/orchestration/createLinnyaAiSdkInferenceCapability';

const route = {
  model_id: 'model-go',
  route_profile_id: 'openai_chat',
  capability_id: 'ai-sdk:openai-compatible',
  endpoint_id: 'opencode-go',
  endpoint_model_id: 'deepseek-fixture',
  api_surface: 'openai_chat_completions',
  base_url: 'https://fixture.invalid/v1',
  auth_profile: 'bearer',
  context_window_tokens: 128_000,
  max_output_tokens: 4_096,
  input_support: { user_image: false, tool_result_image: false },
  usage: { response_usage: 'provider_reported_optional' },
  continuation: { tool_replay: 'optional' },
} satisfies ResolvedInferenceAttemptRoute;

function invocation(): InferenceCapabilityInvocation {
  return {
    request: {
      model_id: route.model_id,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      tools: [],
      tool_choice: 'none',
      sampling: { max_output_tokens: 64 },
      invocation: { trace_id: 'trace-go-session', attempt_id: 'attempt-go-session' },
    },
    route,
    credential: { profile: 'bearer', secret: 'fixture-secret' },
    provider_connection_definition_id: 'opencode-go',
  };
}

describe('OpenCode Go Provider failure policy', () => {
  it.each(['http', 'stream'] as const)(
    '%s 通过真实兼容 SDK 保留具体产品分类且不泄露正文', async transport => {
      const body = JSON.stringify({
        error: { type: 'MissingSessionID', message: 'private upstream account detail' },
      });
      const fixtureFetch: typeof fetch = async () => transport === 'http'
        ? new Response(body, { status: 400, headers: { 'content-type': 'application/json' } })
        : new Response(`data: ${body}\n\ndata: [DONE]\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        });
      const capability = createLinnyaAiSdkInferenceCapability(route.capability_id, route.api_surface, {
        language_models: createAiSdkLanguageModelRegistry(fixtureFetch),
      });
      const events: CanonicalInferenceEvent[] = [];
      for await (const event of capability.stream(invocation())) events.push(event);

      expect(events).toEqual([
        { type: 'start', model_id: route.model_id, attempt_id: 'attempt-go-session' },
        { type: 'failure', kind: 'provider', code: 'opencode_session_required', retryable: false },
      ]);
      expect(JSON.stringify(events)).not.toContain('private');
    }
  );

  it('其它 HTTP 400 即使正文提到 MissingSessionID 仍按原错误分类', async () => {
    const fixtureFetch: typeof fetch = async () => Response.json({
      error: { type: 'invalid_request_error', message: 'MissingSessionID is only a diagnostic label' },
    }, { status: 400 });
    const capability = createLinnyaAiSdkInferenceCapability(route.capability_id, route.api_surface, {
      language_models: createAiSdkLanguageModelRegistry(fixtureFetch),
    });
    const events: CanonicalInferenceEvent[] = [];
    for await (const event of capability.stream(invocation())) events.push(event);

    expect(events[events.length - 1]).toEqual({
      type: 'failure', kind: 'provider', code: 'provider_http_400', retryable: false,
    });
    expect(JSON.stringify(events)).not.toContain('diagnostic label');
  });
});
