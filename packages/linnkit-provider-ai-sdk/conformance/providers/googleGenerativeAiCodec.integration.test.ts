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

describe('Google Generative AI codec conformance', () => {
  it('投影 thought signature、文本和 raw usage', async () => {
    const resolvedRoute = route('ai-sdk:google-generative-ai', 'google_generative_ai', 'api_key');
    let requestUrl = '';
    let apiKey: string | null = null;
    const fixtureFetch: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      apiKey = new Headers(init?.headers).get('x-goog-api-key');
      return eventStream([
        JSON.stringify({
          responseId: 'response-1',
          candidates: [{
            content: {
              role: 'model',
              parts: [
                { text: 'google reasoning', thought: true, thoughtSignature: 'signature-1' },
                { text: 'google answer', thoughtSignature: 'signature-2' },
              ],
            },
            finishReason: 'STOP',
          }],
          usageMetadata: {
            promptTokenCount: 15,
            candidatesTokenCount: 6,
            cachedContentTokenCount: 4,
            thoughtsTokenCount: 2,
            totalTokenCount: 21,
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

    expect(requestUrl).toContain(':streamGenerateContent?alt=sse');
    expect(apiKey).toBe('fixture-secret');
    expect(events).toEqual([
      { type: 'start', model_id: resolvedRoute.model_id, attempt_id: 'attempt-1' },
      { type: 'thought_delta', text: 'google reasoning' },
      {
        type: 'assistant_part_end',
        index: 0,
        part: {
          type: 'reasoning',
          text: 'google reasoning',
          continuation: [{
            schema_version: 2,
            producer: {
              model_id: resolvedRoute.model_id,
              endpoint_id: resolvedRoute.endpoint_id,
              api_surface: resolvedRoute.surface,
              capability_id: resolvedRoute.capability_id,
              endpoint_model_id: resolvedRoute.endpoint_model_id,
            },
            kind: 'ai-sdk:google-part',
            payload: {
              target: 'reasoning',
              text: 'google reasoning',
              thought_signature: 'signature-1',
            },
          }],
        },
      },
      { type: 'answer_delta', text: 'google answer' },
      {
        type: 'assistant_part_end',
        index: 1,
        part: {
          type: 'text',
          text: 'google answer',
          continuation: [{
            schema_version: 2,
            producer: {
              model_id: resolvedRoute.model_id,
              endpoint_id: resolvedRoute.endpoint_id,
              api_surface: resolvedRoute.surface,
              capability_id: resolvedRoute.capability_id,
              endpoint_model_id: resolvedRoute.endpoint_model_id,
            },
            kind: 'ai-sdk:google-part',
            payload: {
              target: 'text',
              text: 'google answer',
              thought_signature: 'signature-2',
            },
          }],
        },
      },
      {
        type: 'usage',
        usage: {
          inputTokens: 11,
          outputTokens: 8,
          cacheReadTokens: 4,
          reasoningTokens: 2,
          source: 'provider-response-usage',
          confidence: 'actual',
          rawUsage: {
            promptTokenCount: 15,
            candidatesTokenCount: 6,
            cachedContentTokenCount: 4,
            thoughtsTokenCount: 2,
            totalTokenCount: 21,
          },
        },
      },
      { type: 'finish', reason: 'stop' },
    ]);
  });
});
