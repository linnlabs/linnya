import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanonicalInferenceEvent,
  CanonicalInferencePort,
  CanonicalInferenceRequest,
} from '@linnlabs/linnkit/ports';
import type { llm } from '@linnlabs/linnkit/runtime-kernel';
import { createDefaultLlmCaller } from '../graphRuntimeFactory';

const MODEL_ID = 'retry-policy-fixture';

function createFixture(options: {
  failures: number;
  retryable?: boolean;
  retryAfterMs?: number;
  failure?: Extract<CanonicalInferenceEvent, { type: 'failure' }>;
  emptyOutput?: boolean;
}) {
  const model: llm.ModelCatalogEntry = {
    id: MODEL_ID,
    enabled: true,
    capabilities: ['chat'],
  };
  const modelCatalog: llm.ModelCatalogLike = {
    getModelById: id => (id === MODEL_ID ? model : undefined),
    getModelsByCapability: capability => (model.capabilities?.includes(capability) ? [model] : []),
    getModelsByUIVisibility: () => [],
  };
  const requests: CanonicalInferenceRequest[] = [];
  const requestTimes: number[] = [];
  const emitted: string[] = [];
  const inferencePort: CanonicalInferencePort = {
    async *stream(request) {
      requests.push(request);
      requestTimes.push(Date.now());
      yield {
        type: 'start',
        model_id: request.model_id,
        attempt_id: request.invocation.attempt_id,
      };
      if (requests.length <= options.failures) {
        if (options.emptyOutput) {
          yield { type: 'finish', reason: 'stop' };
          return;
        }
        // 真实流在断开前可能已有局部输出；最终成功不能保留失败 attempt 的片段。
        yield { type: 'answer_delta', text: 'incomplete attempt' };
        if (options.retryAfterMs !== undefined) {
          throw Object.assign(new Error('Structured retry fixture'), {
            errorCode: 'llm.provider_stream_error',
            recoverable: true,
            retryAfterMs: options.retryAfterMs,
          });
        }
        yield options.failure ?? {
          type: 'failure',
          kind: 'transport',
          code: 'provider_stream_error',
          retryable: options.retryable ?? true,
        };
        return;
      }
      yield { type: 'answer_delta', text: 'complete answer' };
      yield { type: 'finish', reason: 'stop' };
    },
  };
  const caller = createDefaultLlmCaller({ modelCatalog, inferencePort });
  return {
    requests,
    requestTimes,
    emitted,
    call: (signal?: AbortSignal) =>
      caller.callWithRetries(
        MODEL_ID,
        [{ role: 'user', content: 'Complete the synthetic retry fixture.' }],
        { allow_model_fallback: false },
        event => {
          emitted.push(event.type);
        },
        signal
      ),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('默认 Host LlmCaller 的重试业务行为', () => {
  it('断流六次后第七次成功，指数等待并撤回失败片段', async () => {
    const fixture = createFixture({ failures: 6 });
    const call = fixture.call();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.requests).toHaveLength(1);
    for (let retry = 1; retry <= 6; retry += 1) {
      await vi.advanceTimersByTimeAsync(1_500 * 2 ** (retry - 1) - 1);
      expect(fixture.requests).toHaveLength(retry);
      await vi.advanceTimersByTimeAsync(1);
      expect(fixture.requests).toHaveLength(retry + 1);
    }
    await expect(call).resolves.toMatchObject({ content: 'complete answer' });
    expect(fixture.requestTimes).toEqual([0, 1_500, 4_500, 10_500, 22_500, 46_500, 94_500]);
    expect(new Set(fixture.requests.map(request => request.invocation.attempt_id)).size).toBe(7);
    expect(new Set(fixture.requests.map(request => request.invocation.trace_id)).size).toBe(1);
    expect(fixture.requests.every(request => request.model_id === MODEL_ID)).toBe(true);
    expect(fixture.emitted.filter(type => type === 'stream_reset')).toHaveLength(6);
    expect(fixture.emitted.filter(type => type === 'error')).toHaveLength(0);
  });

  it('持续断流只调用七次，耗尽后仅发布一个最终错误', async () => {
    const fixture = createFixture({ failures: 8 });
    const failure = expect(fixture.call()).rejects.toMatchObject({
      errorCode: 'llm.provider_stream_error',
      recoverable: true,
    });
    await vi.runAllTimersAsync();
    await failure;
    expect(fixture.requests).toHaveLength(7);
    expect(fixture.emitted.filter(type => type === 'error')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('不可重试失败只调用一次', async () => {
    const fixture = createFixture({ failures: 8, retryable: false });
    const failure = expect(fixture.call()).rejects.toMatchObject({ recoverable: false });
    await vi.runAllTimersAsync();
    await failure;
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.emitted.filter(type => type === 'error')).toHaveLength(1);
  });

  it.each([
    { emptyOutput: true },
    {
      failure: {
        type: 'failure',
        kind: 'transport',
        code: 'provider_empty_response',
        retryable: true,
        retry_category: 'output',
      },
    },
    {
      failure: {
        type: 'failure',
        kind: 'protocol',
        code: 'provider_tool_arguments_invalid',
        retryable: true,
        retry_category: 'output',
      },
    },
    {
      failure: {
        type: 'failure',
        kind: 'provider',
        code: 'provider_stream_error',
        retryable: true,
      },
    },
  ] satisfies Array<Partial<Parameters<typeof createFixture>[0]>>)(
    '输出损坏和其他故障不消耗六次生成机会：%j',
    async options => {
      const fixture = createFixture({ failures: 8, ...options });
      const failure = expect(fixture.call()).rejects.toBeInstanceOf(Error);
      await vi.runAllTimersAsync();
      await failure;
      expect(fixture.requests).toHaveLength(4);
      expect(fixture.requestTimes).toEqual([0, 1_500, 3_000, 4_500]);
      expect(fixture.emitted.filter(type => type === 'error')).toHaveLength(1);
    }
  );

  it('已明确分类的限流仍指数退避，但预算为三次', async () => {
    const fixture = createFixture({
      failures: 8,
      failure: {
        type: 'failure',
        kind: 'provider',
        code: 'provider_http_429',
        retryable: true,
        retry_category: 'rate_limit',
      },
    });
    const failure = expect(fixture.call()).rejects.toBeInstanceOf(Error);
    await vi.runAllTimersAsync();
    await failure;
    expect(fixture.requests).toHaveLength(4);
    expect(fixture.requestTimes).toEqual([0, 1_500, 4_500, 10_500]);
  });

  it('等待期间取消后不发出下一次请求', async () => {
    const fixture = createFixture({ failures: 8 });
    const controller = new AbortController();
    const failure = expect(fixture.call(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(750);
    controller.abort();
    await vi.runAllTimersAsync();
    await failure;
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.emitted.filter(type => type === 'error')).toHaveLength(0);
  });

  it('保留框架分类给出的较长建议间隔', async () => {
    const fixture = createFixture({ failures: 1, retryAfterMs: 4_000 });
    const call = fixture.call();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(fixture.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(call).resolves.toMatchObject({ content: 'complete answer' });
    expect(fixture.requestTimes).toEqual([0, 4_000]);
  });
});
