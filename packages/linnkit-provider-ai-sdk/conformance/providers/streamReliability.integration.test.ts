import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import type { CanonicalInferenceEvent, CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import { describe, expect, it } from 'vitest';

import {
  createAiSdkInferenceCapability,
  type AiSdkInferenceCapabilityInvocation,
  type AiSdkInferenceRoute,
  type AiSdkLanguageModelRegistry,
} from '@linnlabs/linnkit-provider-ai-sdk';

const route = {
  model_id: 'stream-reliability-model',
  request_profile: 'openai_responses',
  capability_id: 'ai-sdk:openai-responses',
  endpoint_id: 'stream-reliability-endpoint',
  endpoint_model_id: 'gpt-fixture',
  surface: 'openai_responses',
  base_url: 'https://fixture.invalid/v1',
} satisfies AiSdkInferenceRoute;

function invocation(signal?: AbortSignal): AiSdkInferenceCapabilityInvocation {
  const request: CanonicalInferenceRequest = {
    model_id: route.model_id,
    messages: [{ role: 'user', content: [{ type: 'text', text: '继续任务' }] }],
    tools: [],
    tool_choice: 'none',
    sampling: { max_output_tokens: 128, reasoning_effort: 'high' },
    invocation: { trace_id: 'trace-stream-reliability', attempt_id: 'attempt-1' },
    ...(signal ? { signal } : {}),
  };
  return {
    request,
    route,
    credential: { profile: 'bearer', secret: 'fixture-secret' },
  };
}

function modelWithStream(
  createStream: (options: LanguageModelV4CallOptions) => ReadableStream<LanguageModelV4StreamPart>
): LanguageModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'stream-reliability-fixture',
    modelId: 'stream-reliability-fixture-model',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('stream reliability fixture 只支持 doStream');
    },
    doStream: async options => ({ stream: createStream(options) }),
  };
}

function registry(model: LanguageModelV4): AiSdkLanguageModelRegistry {
  return {
    entries: [],
    languageModel: () => model,
  };
}

async function collect(stream: AsyncIterable<CanonicalInferenceEvent>) {
  const events: CanonicalInferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function openTextStream(
  options: LanguageModelV4CallOptions,
  text: string
): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      controller.enqueue({ type: 'text-start', id: 'text-1' });
      controller.enqueue({ type: 'text-delta', id: 'text-1', delta: text });
      options.abortSignal?.addEventListener(
        'abort',
        () => {
          controller.error(options.abortSignal?.reason);
        },
        { once: true }
      );
    },
  });
}

describe('AI SDK stream reliability integration', () => {
  it('首个内容分片长时间未到达时触发可重试 idle timeout', async () => {
    const capability = createAiSdkInferenceCapability(route.capability_id, route.surface, {
      language_models: registry(
        modelWithStream(
          options =>
            new ReadableStream<LanguageModelV4StreamPart>({
              start(controller) {
                options.abortSignal?.addEventListener(
                  'abort',
                  () => controller.error(options.abortSignal?.reason),
                  { once: true }
                );
              },
            })
        )
      ),
      stream_idle_timeout_ms: 25,
    });

    const events = await collect(capability.stream(invocation()));

    expect(events[events.length - 1]).toEqual({
      type: 'failure',
      kind: 'transport',
      code: 'provider_stream_idle_timeout',
      retryable: true,
    });
  });

  it('已有输出后连续无内容分片会触发可重试 idle timeout', async () => {
    const capability = createAiSdkInferenceCapability(route.capability_id, route.surface, {
      language_models: registry(modelWithStream(options => openTextStream(options, 'partial'))),
      stream_idle_timeout_ms: 25,
    });

    const events = await collect(capability.stream(invocation()));

    expect(events).toContainEqual({ type: 'answer_delta', text: 'partial' });
    expect(events[events.length - 1]).toEqual({
      type: 'failure',
      kind: 'transport',
      code: 'provider_stream_idle_timeout',
      retryable: true,
    });
  });

  it('用户取消仍保持 aborted 终因，不伪装成 idle timeout', async () => {
    const abortController = new AbortController();
    const capability = createAiSdkInferenceCapability(route.capability_id, route.surface, {
      language_models: registry(modelWithStream(options => openTextStream(options, 'partial'))),
      stream_idle_timeout_ms: 1_000,
    });
    const eventsPromise = collect(capability.stream(invocation(abortController.signal)));
    setTimeout(() => abortController.abort('user cancelled'), 10);

    const events = await eventsPromise;

    expect(events[events.length - 1]).toEqual({
      type: 'failure',
      kind: 'aborted',
      code: 'request_aborted',
      retryable: false,
    });
  });

  it('Host 检测到的 stream 状态机违规保持不可重试', async () => {
    const model = modelWithStream(
      () =>
        new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-delta', id: 'missing-start', delta: 'invalid' });
            controller.close();
          },
        })
    );
    const capability = createAiSdkInferenceCapability(route.capability_id, route.surface, {
      language_models: registry(model),
      stream_idle_timeout_ms: 1_000,
    });

    const events = await collect(capability.stream(invocation()));

    expect(events[events.length - 1]).toEqual({
      type: 'failure',
      kind: 'protocol',
      code: 'provider_stream_lifecycle_invalid',
      retryable: false,
    });
  });

  it('未知上游 stream rejection 形成可重试 transport failure 且不传播正文', async () => {
    const model = modelWithStream(
      () =>
        new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.error(new Error('sensitive gateway disconnect detail'));
          },
        })
    );
    const capability = createAiSdkInferenceCapability(route.capability_id, route.surface, {
      language_models: registry(model),
      stream_idle_timeout_ms: 1_000,
    });

    const events = await collect(capability.stream(invocation()));

    expect(events[events.length - 1]).toEqual({
      type: 'failure',
      kind: 'transport',
      code: 'provider_stream_error',
      retryable: true,
    });
    expect(JSON.stringify(events)).not.toContain('sensitive gateway disconnect detail');
  });

  it('在失败 attempt 结束时发布可聚合的请求形状与流终态诊断', async () => {
    const diagnostics: Array<{ readonly type: string; readonly [key: string]: unknown }> = [];
    const capability = createAiSdkInferenceCapability(route.capability_id, route.surface, {
      language_models: registry(modelWithStream(options => openTextStream(options, 'partial'))),
      stream_idle_timeout_ms: 25,
      diagnostic_sink: { publish: diagnostic => diagnostics.push(diagnostic) },
    });

    await collect(capability.stream(invocation()));

    const observed = diagnostics.find(diagnostic => diagnostic.type === 'attempt_observed');
    const timeout = diagnostics.find(diagnostic => diagnostic.type === 'stream_idle_timeout');
    expect(timeout).toMatchObject({
      attempt_id: 'attempt-1',
      request_fingerprint: expect.stringMatching(/^[0-9a-f]{32}$/u),
    });
    expect(observed).toMatchObject({
      attempt_id: 'attempt-1',
      capability_id: route.capability_id,
      surface: route.surface,
      endpoint_id: route.endpoint_id,
      request_fingerprint: expect.stringMatching(/^[0-9a-f]{32}$/u),
      message_count: 1,
      text_characters: 4,
      estimated_input_tokens: 1,
      tool_count: 0,
      image_count: 0,
      image_bytes: 0,
      retry_count: 0,
      terminal_event_received: true,
      terminal_event_type: 'failure',
      last_provider_part_type: 'abort',
    });
  });
});
