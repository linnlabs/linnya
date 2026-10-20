import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalInferencePort, CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import type { llm } from '@linnlabs/linnkit/runtime-kernel';
import {
  createAiSdkInferenceCapability,
  createAiSdkLanguageModelRegistry,
  type AiSdkInferenceRoute,
} from '@linnlabs/linnkit-provider-ai-sdk';
import { createDefaultLlmCaller } from '../graphRuntimeFactory';

const route: AiSdkInferenceRoute = {
  model_id: 'retry-codec-fixture',
  request_profile: 'openai_compatible_chat',
  capability_id: 'ai-sdk:openai-compatible',
  surface: 'openai_chat_completions',
  endpoint_id: 'fixture',
  endpoint_model_id: 'fixture',
  base_url: 'https://fixture.invalid/v1',
};
const entry: llm.ModelCatalogEntry = { id: route.model_id, enabled: true, capabilities: ['chat'] };
const modelCatalog: llm.ModelCatalogLike = {
  getModelById: id => (id === entry.id ? entry : undefined),
  getModelsByCapability: capability => (entry.capabilities?.includes(capability) ? [entry] : []),
  getModelsByUIVisibility: () => [],
};

function response(content: unknown, finish: boolean): Response {
  return new Response(
    `data: ${JSON.stringify({
      choices: [
        {
          index: 0,
          delta: { content },
          finish_reason: finish ? 'stop' : null,
        },
      ],
    })}\n\n${finish ? 'data: [DONE]\n\n' : ''}`,
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('真实SDK失败经过默认Host重试闭环', () => {
  it.each([
    { name: '提前EOF', expectedResetCount: 1, first: () => response('incomplete attempt', false) },
    {
      name: '缺message的上游timeout',
      expectedResetCount: 1,
      first: () =>
        new Response(
          'data: {"choices":[{"delta":{"content":"incomplete attempt"},"finish_reason":null}]}\n\n' +
            'data: {"error":{"type":"timeout_error","code":"timeout"}}\n\n',
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        ),
    },
    {
      name: 'HTTP200后读取失败',
      expectedResetCount: 0,
      first: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new TypeError('sensitive socket detail'));
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        ),
    },
  ])('$name自动恢复，失败片段撤回，SDK不额外发请求', async fixture => {
    vi.useFakeTimers();
    const requests: CanonicalInferenceRequest[] = [];
    let httpRequests = 0;
    const capability = createAiSdkInferenceCapability(route.capability_id, route.surface, {
      language_models: createAiSdkLanguageModelRegistry(async () => {
        httpRequests += 1;
        return httpRequests === 1 ? fixture.first() : response('complete answer', true);
      }),
    });
    const inferencePort: CanonicalInferencePort = {
      stream(request) {
        requests.push(request);
        return capability.stream({
          request,
          route,
          credential: { profile: 'bearer', secret: 'fixture' },
        });
      },
    };
    const events: string[] = [];
    const caller = createDefaultLlmCaller({ modelCatalog, inferencePort });
    const call = caller.callWithRetries(
      entry.id,
      [{ role: 'user', content: 'Complete the fixture.' }],
      { allow_model_fallback: false },
      event => {
        events.push(event.type);
      }
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(httpRequests).toBe(1);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(httpRequests).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(call).resolves.toMatchObject({ content: 'complete answer' });
    expect(httpRequests).toBe(2);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.invocation.trace_id).toBe(requests[1]?.invocation.trace_id);
    expect(requests[0]?.invocation.attempt_id).not.toBe(requests[1]?.invocation.attempt_id);
    expect(events.filter(type => type === 'stream_reset')).toHaveLength(fixture.expectedResetCount);
    expect(events).not.toContain('error');
  });

  it('真实字段不兼容只调用一次，不消耗网络重试预算', async () => {
    let httpRequests = 0;
    const capability = createAiSdkInferenceCapability(route.capability_id, route.surface, {
      language_models: createAiSdkLanguageModelRegistry(async () => {
        httpRequests += 1;
        return response(123, true);
      }),
    });
    const caller = createDefaultLlmCaller({
      modelCatalog,
      inferencePort: {
        stream: request =>
          capability.stream({
            request,
            route,
            credential: { profile: 'bearer', secret: 'fixture' },
          }),
      },
    });
    await expect(
      caller.callWithRetries(entry.id, [{ role: 'user', content: 'Complete the fixture.' }], {
        allow_model_fallback: false,
      })
    ).rejects.toMatchObject({
      errorCode: 'llm.provider_response_schema_invalid',
      recoverable: false,
    });
    expect(httpRequests).toBe(1);
  });
});
