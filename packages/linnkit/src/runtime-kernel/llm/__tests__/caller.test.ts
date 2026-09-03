import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanonicalInferenceEvent,
  CanonicalInferencePort,
  CanonicalInferenceRequest,
} from '../../../ports';
import type { AiMessage, ProviderContinuation } from '../../../contracts';
import type { AnyAgentEvent } from '../../events/agentEvents';
import { LlmCaller } from '../caller';
import type { ModelCatalogLike } from '../modelCatalog';

type AttemptScript = (
  request: CanonicalInferenceRequest
) => AsyncIterable<CanonicalInferenceEvent>;

const testMessages: AiMessage[] = [{
  role: 'user',
  type: 'user_input',
  content: 'Hello',
  id: 'msg_test_1',
  timestamp: 1,
}];

function modelCatalog(): ModelCatalogLike {
  const entry = {
    id: 'test-model',
    enabled: true,
    capabilities: ['chat'],
    adapter_input_support: { user_image: false, tool_result_image: false },
    billing_mode: 'byok' as const,
  };
  return {
    getModelById: id => ({ ...entry, id }),
    getModelsByCapability: () => [entry],
    getModelsByUIVisibility: () => [entry],
  };
}

function createScriptedPort(scripts: AttemptScript[]) {
  const requests: CanonicalInferenceRequest[] = [];
  const port: CanonicalInferencePort = {
    stream(request) {
      requests.push(request);
      const script = scripts.shift();
      if (!script) throw new Error('missing inference script');
      return script(request);
    },
  };
  return { port, requests };
}

async function* successful(
  request: CanonicalInferenceRequest,
  content = 'ok'
): AsyncIterable<CanonicalInferenceEvent> {
  yield { type: 'start', model_id: request.model_id, attempt_id: request.invocation.attempt_id };
  if (content) yield { type: 'answer_delta', text: content };
  yield { type: 'finish', reason: 'stop' };
}

function continuation(): ProviderContinuation {
  return {
    schema_version: 2,
    producer: {
      model_id: 'test-model',
      endpoint_id: 'example',
      api_surface: 'openai_chat_completions',
      capability_id: 'test:chat-codec',
      endpoint_model_id: 'upstream-model',
    },
    kind: 'reasoning_content',
    payload: { reasoning_content: 'opaque' },
  };
}

describe('LlmCaller canonical inference 主链', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('把 Linnkit 调用投影为 vendor-neutral request，并只返回 canonical 结果', async () => {
    const harness = createScriptedPort([request => successful(request, 'hello')]);
    const caller = new LlmCaller({ inferencePort: harness.port, modelCatalog: modelCatalog() });

    await expect(caller.call('test-model', testMessages, {
      temperature: 0.4,
      top_p: 0.9,
      max_tokens: 512,
      reasoning_effort: 'off',
      tools: [{
        name: 'weather',
        description: 'read weather',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string', description: 'city' } },
          required: ['city'],
        },
      }],
      tool_choice: { type: 'tool', name: 'weather' },
    })).resolves.toEqual({ content: 'hello' });

    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]).toMatchObject({
      model_id: 'test-model',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      tools: [{ name: 'weather' }],
      tool_choice: { type: 'tool', name: 'weather' },
      sampling: {
        temperature: 0.4,
        top_p: 0.9,
        max_output_tokens: 512,
        reasoning_effort: 'none',
      },
    });
    expect(harness.requests[0]?.invocation.trace_id).toMatch(/^trace-/);
    expect(harness.requests[0]?.invocation.attempt_id).toMatch(/^inference-attempt-/);
  });

  it('保持 answer/thought/tool/continuation/usage 的结构化边界', async () => {
    const replay = continuation();
    const canonicalUsage = {
      inputTokens: 12,
      outputTokens: 5,
      reasoningTokens: 2,
      totalTokens: 17,
      source: 'provider-response-usage' as const,
      confidence: 'actual' as const,
      rawUsage: { prompt_tokens: 12, completion_tokens: 5 },
    };
    const harness = createScriptedPort([async function* (request) {
      yield { type: 'start', model_id: request.model_id, attempt_id: request.invocation.attempt_id };
      yield { type: 'thought_delta', text: '分析' };
      yield {
        type: 'assistant_part_end',
        index: 0,
        part: { type: 'reasoning', text: '分析', continuation: [replay] },
      };
      yield { type: 'answer_delta', text: '准备查询' };
      yield {
        type: 'assistant_part_end',
        index: 2,
        part: { type: 'text', text: '准备查询' },
      };
      yield { type: 'tool_call_start', index: 0, part_index: 1, id: 'call-1', name: 'weather' };
      yield { type: 'tool_argument_delta', index: 0, json_delta: '{"city":"北京"}' };
      yield {
        type: 'tool_call_end',
        index: 0,
        call: { id: 'call-1', name: 'weather', arguments: { city: '北京' } },
      };
      yield { type: 'usage', usage: canonicalUsage };
      yield { type: 'finish', reason: 'tool_use' };
    }]);
    const caller = new LlmCaller({ inferencePort: harness.port, modelCatalog: modelCatalog() });
    const events: AnyAgentEvent[] = [];

    const result = await caller.callStream(
      'test-model',
      testMessages,
      {},
      event => events.push(event)
    );

    expect(result).toEqual({
      content: '准备查询',
      tool_calls: [{
        id: 'call-1',
        type: 'function',
        function: { name: 'weather', arguments: '{"city":"北京"}' },
      }],
      provider_continuations: [replay],
      assistant_replay_parts: [
        { type: 'reasoning', text: '分析', provider_continuations: [replay] },
        { type: 'tool_call', tool_call_id: 'call-1' },
        { type: 'text', text: '准备查询' },
      ],
      canonicalUsage,
    });
    expect(events.some(event => event.type === 'thought' && event.delta === '分析')).toBe(true);
    expect(events.some(event => event.type === 'stream_chunk' && event.content === '准备查询')).toBe(true);
    expect(events.some(event => event.type === 'provider_continuation')).toBe(true);
  });

  it('canonical failure 直接形成结构化错误，不读取 Provider body', async () => {
    const harness = createScriptedPort([async function* (request) {
      yield { type: 'start', model_id: request.model_id, attempt_id: request.invocation.attempt_id };
      yield { type: 'failure', kind: 'provider', code: 'provider_http_401', retryable: false };
    }]);
    const caller = new LlmCaller({
      inferencePort: harness.port,
      modelCatalog: modelCatalog(),
      maxRetries: 0,
    });
    const events: AnyAgentEvent[] = [];

    await expect(caller.callWithRetries(
      'test-model',
      testMessages,
      {},
      event => events.push(event)
    )).rejects.toMatchObject({
      errorCode: 'llm.provider_http_401',
      recoverable: false,
      metadata: { failure_kind: 'provider', provider_code: 'provider_http_401' },
    });
    expect(events.filter(event => event.type === 'error')).toHaveLength(1);
  });

  it('同一 retry 链共享 trace_id，但每个真实 attempt 使用新 attempt_id', async () => {
    const harness = createScriptedPort([
      async function* (request) {
        yield { type: 'start', model_id: request.model_id, attempt_id: request.invocation.attempt_id };
        yield { type: 'failure', kind: 'transport', code: 'network_unavailable', retryable: true };
      },
      request => successful(request, 'retried'),
    ]);
    const caller = new LlmCaller({
      inferencePort: harness.port,
      modelCatalog: modelCatalog(),
      maxRetries: 1,
      retryDelayMs: 0,
    });

    await expect(caller.callWithRetries('test-model', testMessages))
      .resolves.toEqual({ content: 'retried' });
    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[0]?.invocation.trace_id)
      .toBe(harness.requests[1]?.invocation.trace_id);
    expect(harness.requests[0]?.invocation.attempt_id)
      .not.toBe(harness.requests[1]?.invocation.attempt_id);
  });

  it('流式 attempt 超时重试前撤回部分输出，成功答案不受前次内容污染', async () => {
    const harness = createScriptedPort([
      async function* (request) {
        yield { type: 'start', model_id: request.model_id, attempt_id: request.invocation.attempt_id };
        yield { type: 'answer_delta', text: 'partial' };
        yield {
          type: 'failure',
          kind: 'transport',
          code: 'provider_stream_idle_timeout',
          retryable: true,
        };
      },
      request => successful(request, 'final'),
    ]);
    const caller = new LlmCaller({
      inferencePort: harness.port,
      modelCatalog: modelCatalog(),
      maxRetries: 1,
      retryDelayMs: 0,
    });
    const events: AnyAgentEvent[] = [];

    await expect(caller.callWithRetries(
      'test-model',
      testMessages,
      {},
      event => events.push(event)
    )).resolves.toEqual({ content: 'final' });

    const partialIndex = events.findIndex(
      event => event.type === 'stream_chunk' && event.content === 'partial'
    );
    const resetIndex = events.findIndex(event => event.type === 'stream_reset');
    const finalIndex = events.findIndex(
      event => event.type === 'stream_chunk' && event.content === 'final'
    );
    const partial = events[partialIndex];
    const reset = events[resetIndex];

    expect(partialIndex).toBeGreaterThanOrEqual(0);
    expect(resetIndex).toBeGreaterThan(partialIndex);
    expect(finalIndex).toBeGreaterThan(resetIndex);
    expect(events.filter(event => event.type === 'stream_reset')).toHaveLength(1);
    expect(events.filter(event => event.type === 'error')).toHaveLength(0);
    if (partial?.type !== 'stream_chunk' || reset?.type !== 'stream_reset') {
      throw new Error('retry 前必须先发出 partial stream_chunk 与 stream_reset');
    }
    expect(reset.answer_id).toBe(partial.answer_id);
  });

  it('Provider stream 在 terminal 前 EOF 时按协议错误失败', async () => {
    const harness = createScriptedPort([async function* (request) {
      yield { type: 'start', model_id: request.model_id, attempt_id: request.invocation.attempt_id };
      yield { type: 'answer_delta', text: 'partial' };
    }]);
    const caller = new LlmCaller({ inferencePort: harness.port, modelCatalog: modelCatalog() });

    await expect(caller.call('test-model', testMessages)).rejects.toThrow(/terminal event 前结束/);
  });

  it('assistant tool arguments 不是 JSON object 时在 Provider 调用前失败', async () => {
    const harness = createScriptedPort([request => successful(request)]);
    const caller = new LlmCaller({ inferencePort: harness.port, modelCatalog: modelCatalog() });

    await expect(caller.call('test-model', [{
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call-invalid',
        type: 'function',
        function: { name: 'bad', arguments: '[]' },
      }],
    }])).rejects.toThrow(/必须是 JSON object/);
    expect(harness.requests).toHaveLength(0);
  });
});
