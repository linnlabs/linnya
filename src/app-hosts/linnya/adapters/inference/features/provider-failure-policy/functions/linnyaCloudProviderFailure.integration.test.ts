import type { CanonicalInferenceEvent, CanonicalInferenceRequest } from 'linnkit/ports';
import { createAiSdkLanguageModelRegistry } from '@linnlabs/linnkit-provider-ai-sdk';
import { describe, expect, it } from 'vitest';
import type {
  InferenceCapabilityInvocation,
  ResolvedInferenceAttemptRoute,
} from '../../../definitions/inferenceCapability';
import { createLinnyaAiSdkInferenceCapability } from '../../ai-sdk-language-composition/orchestration/createLinnyaAiSdkInferenceCapability';
import { linnyaProviderFailureClassifier } from './classifyLinnyaProviderFailure';

const route = {
  model_id: 'model-1',
  route_profile_id: 'openai_chat',
  capability_id: 'ai-sdk:openai-chat',
  endpoint_id: 'linnya-cloud',
  endpoint_model_id: 'gpt-fixture',
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
  const request: CanonicalInferenceRequest = {
    model_id: route.model_id,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools: [],
    tool_choice: 'none',
    sampling: { max_output_tokens: 64 },
    invocation: { trace_id: 'trace-cloud-quota', attempt_id: 'attempt-cloud-quota' },
  };
  return {
    request,
    route,
    credential: { profile: 'bearer', secret: 'fixture-secret' },
  };
}

async function collect(
  stream: AsyncIterable<CanonicalInferenceEvent>
): Promise<CanonicalInferenceEvent[]> {
  const events: CanonicalInferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('Linnya Cloud Provider failure policy', () => {
  it('经 Host classifier 投影稳定配额错误码且不泄露上游正文', async () => {
    const fixtureFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: '今日使用次数已达上限（内含账户详情）' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    const capability = createLinnyaAiSdkInferenceCapability(
      route.capability_id,
      route.api_surface,
      {
        language_models: createAiSdkLanguageModelRegistry(fixtureFetch),
        provider_failure_classifier: linnyaProviderFailureClassifier,
      }
    );

    const events = await collect(capability.stream(invocation()));

    expect(events).toEqual([
      { type: 'start', model_id: route.model_id, attempt_id: 'attempt-cloud-quota' },
      { type: 'failure', kind: 'provider', code: 'cloud_quota_exhausted', retryable: false },
    ]);
    expect(JSON.stringify(events)).not.toContain('账户详情');
  });
});
