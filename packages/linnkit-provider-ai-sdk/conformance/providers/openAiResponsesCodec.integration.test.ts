import { describe, expect, it } from 'vitest';
import {
  createAiSdkInferenceCapability,
  createAiSdkLanguageModelRegistry,
} from '@linnlabs/linnkit-provider-ai-sdk';
import {
  collectProviderSurfaceEvents as collect,
  providerSurfaceEventStream as eventStream,
  providerSurfaceInvocation as invocation,
  providerSurfaceRoute as route,
} from '../fixtures/providerSurfaceCodecFixture';

describe('OpenAI Responses codec conformance', () => {
  it('从正式 codec 投影文本与 raw usage', async () => {
    const resolvedRoute = route('ai-sdk:openai-responses', 'openai_responses', 'bearer');
    let requestUrl = '';
    let requestBody: unknown;
    const fixtureFetch: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      if (typeof init?.body === 'string') requestBody = JSON.parse(init.body);
      return eventStream([
        JSON.stringify({
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'message', id: 'message-1', phase: 'final_answer' },
        }),
        JSON.stringify({
          type: 'response.output_text.delta',
          item_id: 'message-1',
          output_index: 0,
          delta: 'responses answer',
        }),
        JSON.stringify({
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            type: 'message',
            id: 'message-1',
            phase: 'final_answer',
            content: [],
          },
        }),
        JSON.stringify({
          type: 'response.completed',
          response: {
            incomplete_details: null,
            usage: {
              input_tokens: 14,
              input_tokens_details: { cached_tokens: 3 },
              output_tokens: 6,
              output_tokens_details: { reasoning_tokens: 2 },
            },
            reasoning: null,
            service_tier: null,
          },
        }),
      ]);
    };
    const capability = createAiSdkInferenceCapability(
      resolvedRoute.capability_id,
      resolvedRoute.surface,
      { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) },
    );

    const events = await collect(capability.stream(invocation(resolvedRoute)));

    expect(requestUrl).toBe('https://fixture.invalid/v1/responses');
    expect(requestBody).toMatchObject({
      model: resolvedRoute.endpoint_model_id,
      stream: true,
      store: false,
      temperature: 0,
      max_output_tokens: 128,
    });
    expect(events).toEqual([
      { type: 'start', model_id: resolvedRoute.model_id, attempt_id: 'attempt-1' },
      { type: 'answer_delta', text: 'responses answer' },
      {
        type: 'assistant_part_end',
        index: 0,
        part: {
          type: 'text',
          text: 'responses answer',
          continuation: [{
            schema_version: 2,
            producer: {
              model_id: resolvedRoute.model_id,
              endpoint_id: resolvedRoute.endpoint_id,
              api_surface: resolvedRoute.surface,
              capability_id: resolvedRoute.capability_id,
              endpoint_model_id: resolvedRoute.endpoint_model_id,
            },
            kind: 'ai-sdk:openai-responses-part',
            payload: { target: 'text', text: 'responses answer', item_id: 'message-1' },
          }],
        },
      },
      {
        type: 'usage',
        usage: {
          inputTokens: 11,
          outputTokens: 6,
          cacheReadTokens: 3,
          reasoningTokens: 2,
          source: 'provider-response-usage',
          confidence: 'actual',
          rawUsage: {
            input_tokens: 14,
            input_tokens_details: { cached_tokens: 3 },
            output_tokens: 6,
            output_tokens_details: { reasoning_tokens: 2 },
          },
        },
      },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('兼容网关的 max_tokens incomplete 投影为 length', async () => {
    const resolvedRoute = route('ai-sdk:openai-responses', 'openai_responses', 'bearer');
    const fixtureFetch: typeof fetch = async () => eventStream([
      JSON.stringify({
        type: 'response.incomplete',
        response: {
          incomplete_details: { reason: 'max_tokens' },
          usage: {
            input_tokens: 14,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 128,
            output_tokens_details: { reasoning_tokens: 128 },
          },
          reasoning: null,
          service_tier: null,
        },
      }),
    ]);
    const capability = createAiSdkInferenceCapability(
      resolvedRoute.capability_id,
      resolvedRoute.surface,
      { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) },
    );

    const events = await collect(capability.stream(invocation(resolvedRoute)));

    expect(events[events.length - 1]).toEqual({ type: 'finish', reason: 'length' });
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'failure' }));
  });

  it('server_error incomplete 投影为可重试 Provider 故障', async () => {
    const resolvedRoute = route('ai-sdk:openai-responses', 'openai_responses', 'bearer');
    const fixtureFetch: typeof fetch = async () => eventStream([
      JSON.stringify({
        type: 'response.incomplete',
        response: {
          incomplete_details: { reason: 'server_error' },
          usage: {
            input_tokens: 14,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 0,
            output_tokens_details: { reasoning_tokens: 0 },
          },
          reasoning: null,
          service_tier: null,
        },
      }),
    ]);
    const capability = createAiSdkInferenceCapability(
      resolvedRoute.capability_id,
      resolvedRoute.surface,
      { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) },
    );

    const events = await collect(capability.stream(invocation(resolvedRoute)));

    expect(events[events.length - 1]).toEqual({
      type: 'failure',
      kind: 'provider',
      code: 'provider_stream_unavailable',
      retryable: true,
    });
  });

  it('已输出 reasoning 后的 response.failed 仍投影为可重试 Provider 故障', async () => {
    const resolvedRoute = route('ai-sdk:openai-responses', 'openai_responses', 'bearer');
    const fixtureFetch: typeof fetch = async () => eventStream([
      JSON.stringify({
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'reasoning', id: 'reasoning-1', encrypted_content: 'encrypted-1' },
      }),
      JSON.stringify({
        type: 'response.reasoning_summary_part.added',
        item_id: 'reasoning-1',
        output_index: 0,
        summary_index: 0,
      }),
      JSON.stringify({
        type: 'response.reasoning_summary_text.delta',
        item_id: 'reasoning-1',
        output_index: 0,
        summary_index: 0,
        delta: 'planning file creation',
      }),
      JSON.stringify({
        type: 'response.reasoning_summary_part.done',
        item_id: 'reasoning-1',
        output_index: 0,
        summary_index: 0,
      }),
      JSON.stringify({
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'reasoning', id: 'reasoning-1', encrypted_content: 'encrypted-1' },
      }),
      JSON.stringify({
        type: 'response.failed',
        sequence_number: 6,
        response: {
          error: { code: 'server_error', message: 'sensitive upstream response' },
          incomplete_details: null,
          usage: null,
          reasoning: null,
          service_tier: null,
        },
      }),
    ]);
    const capability = createAiSdkInferenceCapability(
      resolvedRoute.capability_id,
      resolvedRoute.surface,
      { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) },
    );

    const events = await collect(capability.stream(invocation(resolvedRoute)));

    expect(events).toContainEqual({ type: 'thought_delta', text: 'planning file creation' });
    expect(events[events.length - 1]).toEqual({
      type: 'failure',
      kind: 'provider',
      code: 'provider_stream_unavailable',
      retryable: true,
    });
    expect(JSON.stringify(events)).not.toContain('sensitive upstream response');
    expect(events).not.toContainEqual(expect.objectContaining({
      code: 'provider_stream_lifecycle_invalid',
    }));
  });
});
