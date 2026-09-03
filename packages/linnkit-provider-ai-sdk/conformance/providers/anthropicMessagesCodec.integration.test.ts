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

describe('Anthropic Messages codec conformance', () => {
  it('投影 thinking signature、文本和 raw usage', async () => {
    const resolvedRoute = route('ai-sdk:anthropic-messages', 'anthropic_messages', 'api_key');
    let requestUrl = '';
    let apiKey: string | null = null;
    const fixtureFetch: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      apiKey = new Headers(init?.headers).get('x-api-key');
      return eventStream([
        JSON.stringify({
          type: 'message_start',
          message: {
            id: 'message-1',
            model: resolvedRoute.endpoint_model_id,
            role: 'assistant',
            usage: {
              input_tokens: 12,
              cache_creation_input_tokens: 2,
              cache_read_input_tokens: 3,
            },
          },
        }),
        JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        }),
        JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'reasoning' },
        }),
        JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'signature-1' },
        }),
        JSON.stringify({ type: 'content_block_stop', index: 0 }),
        JSON.stringify({
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: '' },
        }),
        JSON.stringify({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'anthropic answer' },
        }),
        JSON.stringify({ type: 'content_block_stop', index: 1 }),
        JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: {
            output_tokens: 7,
            output_tokens_details: { thinking_tokens: 2 },
            cache_creation_input_tokens: 2,
            cache_read_input_tokens: 3,
          },
        }),
        JSON.stringify({ type: 'message_stop' }),
      ]);
    };
    const capability = createAiSdkInferenceCapability(
      resolvedRoute.capability_id,
      resolvedRoute.surface,
      { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) },
    );

    const events = await collect(capability.stream(invocation(resolvedRoute)));

    expect(requestUrl).toBe('https://fixture.invalid/v1/messages');
    expect(apiKey).toBe('fixture-secret');
    expect(events).toEqual([
      { type: 'start', model_id: resolvedRoute.model_id, attempt_id: 'attempt-1' },
      { type: 'thought_delta', text: 'reasoning' },
      {
        type: 'assistant_part_end',
        index: 0,
        part: {
          type: 'reasoning',
          text: 'reasoning',
          continuation: [{
            schema_version: 2,
            producer: {
              model_id: resolvedRoute.model_id,
              endpoint_id: resolvedRoute.endpoint_id,
              api_surface: resolvedRoute.surface,
              capability_id: resolvedRoute.capability_id,
              endpoint_model_id: resolvedRoute.endpoint_model_id,
            },
            kind: 'ai-sdk:anthropic-reasoning',
            payload: {
              target: 'reasoning',
              text: 'reasoning',
              signature: 'signature-1',
            },
          }],
        },
      },
      { type: 'answer_delta', text: 'anthropic answer' },
      {
        type: 'assistant_part_end',
        index: 1,
        part: { type: 'text', text: 'anthropic answer' },
      },
      {
        type: 'usage',
        usage: {
          inputTokens: 12,
          outputTokens: 7,
          cacheReadTokens: 3,
          cacheWriteTokens: 2,
          reasoningTokens: 2,
          source: 'provider-response-usage',
          confidence: 'actual',
          rawUsage: {
            input_tokens: 12,
            cache_creation_input_tokens: 2,
            cache_read_input_tokens: 3,
            output_tokens: 7,
            output_tokens_details: { thinking_tokens: 2 },
          },
        },
      },
      { type: 'finish', reason: 'stop' },
    ]);
  });
});
