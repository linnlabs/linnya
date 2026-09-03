/**
 * @file apps/renderer/domains/conversation/services/conversationService.test.ts
 * @description conversationService 的网络层错误收敛测试
 *
 * 目标：
 * - 非 2xx / reader failure 是客户端 transport error，不能伪造成 RuntimeEvent error；
 * - 服务端事件必须通过共享 schema 校验，transport_end 只收敛当前 reader。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConversationNextRequest, ConversationUserInputCommittedEvent } from '@app/schemas';
import { createPinia, setActivePinia } from 'pinia';
// 由于 conversationService 在模块顶层依赖 getApiBaseUrl，这里用 mock 固定返回值，避免访问真实环境
vi.mock('../../../shared/services/aiService/common', () => ({
  getApiBaseUrl: async () => 'http://localhost:9999',
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
}));

import { streamConversation, type ConversationTransportError } from './conversationService';
import {
  createSSETransportEndEvent,
  createSSEThoughtEvent,
  type SSESummarizationErrorEvent,
  type SSETransportEndEvent,
  type SSEThoughtEvent,
  RunIdSchema,
} from 'linnkit/contracts';

type CallbackBag = {
  onTransportError: (e: ConversationTransportError) => void;
  onTransportEnd: (e?: SSETransportEndEvent) => void;
};

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function createStreamingResponseFromChunks(payloadChunks: readonly Uint8Array[]): {
  readonly response: Response;
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
} {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of payloadChunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  const response = new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
  if (!response.body) {
    throw new Error('streaming response body is required');
  }
  const reader = response.body.getReader();
  vi.spyOn(response.body, 'getReader').mockReturnValue(reader);
  return { response, reader };
}

function createStreamingResponse(payloadText?: string): {
  readonly response: Response;
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
} {
  const transportEnd = createSSETransportEndEvent('end-test', 'conv-stream', 'turn-stream', {
    execution_id: 'execution-stream',
    reason: 'complete',
  });
  const payload = payloadText ?? `event: transport_end\ndata: ${JSON.stringify(transportEnd)}\n\n`;
  return createStreamingResponseFromChunks([new TextEncoder().encode(payload)]);
}

describe('conversationService - HTTP 非 2xx 错误收敛', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('429 作为客户端 transport error 上报，不伪造服务端 RuntimeEvent', async () => {
    const response = {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      body: null,
      text: async () => JSON.stringify({ error: { message: 'Rate limit exceeded' } }),
    } as unknown as Response;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );

    const onTransportError = vi.fn<(e: ConversationTransportError) => void>();
    const onTransportEnd = vi.fn<(e?: SSETransportEndEvent) => void>();

    const req: ConversationNextRequest = {
      conversation_id: 'conv_test_429',
      new_events: [],
      options: {},
    };

    await streamConversation(req, { onTransportError, onTransportEnd } satisfies CallbackBag);

    expect(onTransportError).toHaveBeenCalledTimes(1);
    const failure = onTransportError.mock.calls[0]?.[0];
    expect(failure?.source).toBe('client');
    if (!failure || failure.source !== 'client') throw new Error('expected client transport error');
    expect(failure.kind).toBe('http');
    expect(failure.error.message).toContain('限流');
    expect(failure.errorCode).toBe('HTTP_429');
    expect(failure.retryable).toBe(true);
    const details = failure.details;
    if (!isRecord(details)) throw new Error('transport details should be an object');
    expect(details.rawMessage).toBe('Rate limit exceeded');

    expect(onTransportEnd).toHaveBeenCalledTimes(1);
    expect(onTransportEnd).toHaveBeenCalledWith();
  });

  it('500 非 JSON body 仍走客户端 transport error', async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      body: null,
      text: async () => 'not-json',
    } as unknown as Response;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );

    const onTransportError = vi.fn<(e: ConversationTransportError) => void>();
    const onTransportEnd = vi.fn<(e?: SSETransportEndEvent) => void>();

    const req: ConversationNextRequest = {
      conversation_id: 'conv_test_500',
      new_events: [],
      options: {},
    };

    await streamConversation(req, { onTransportError, onTransportEnd } satisfies CallbackBag);

    expect(onTransportError).toHaveBeenCalledTimes(1);
    const failure = onTransportError.mock.calls[0]?.[0];
    if (!failure || failure.source !== 'client') throw new Error('expected client transport error');
    expect(failure.errorCode).toBe('HTTP_500');
    expect(failure.retryable).toBe(true);
    expect(failure.error.message.length).toBeGreaterThan(0);

    expect(onTransportEnd).toHaveBeenCalledTimes(1);
    expect(onTransportEnd).toHaveBeenCalledWith();
  });

  it('自然读完 SSE 时只释放 reader 锁，不取消已完成的流', async () => {
    const { response, reader } = createStreamingResponse();
    const cancel = vi.spyOn(reader, 'cancel');
    const releaseLock = vi.spyOn(reader, 'releaseLock');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );
    const onTransportEnd = vi.fn<(e?: SSETransportEndEvent) => void>();

    await streamConversation({ conversation_id: 'conv-stream' }, { onTransportEnd });

    expect(onTransportEnd).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it('任意字节边界、CRLF 和多行 data 下仍严格按 wire 顺序分发', async () => {
    const thought = createSSEThoughtEvent('thought-chunked', 'conv-stream', 'turn-chunked', {
      delta: '中文思考',
    });
    const transportEnd = createSSETransportEndEvent('end-chunked', 'conv-stream', 'turn-chunked', {
      execution_id: 'execution-chunked',
      reason: 'complete',
    });
    const thoughtJson = JSON.stringify(thought);
    const multilineAt = thoughtJson.indexOf(',"turn_id"');
    if (multilineAt < 0) throw new Error('thought fixture must contain turn_id');
    const wire = [
      'event:thought\r\n',
      `data:${thoughtJson.slice(0, multilineAt + 1)}\r\n`,
      `data:${thoughtJson.slice(multilineAt + 1)}\r\n`,
      '\r\n',
      'event: transport_end\r\n',
      `data: ${JSON.stringify(transportEnd)}\r\n`,
      '\r\n',
    ].join('');
    const chunks = Array.from(new TextEncoder().encode(wire), byte => Uint8Array.of(byte));
    const { response } = createStreamingResponseFromChunks(chunks);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );
    const order: string[] = [];

    const outcome = await streamConversation(
      { conversation_id: 'conv-stream' },
      {
        onThought: async event => {
          order.push(`${event.type}:${event.delta}`);
        },
        onTransportEnd: async event => {
          order.push(`${event?.type}:${event?.reason}`);
        },
      }
    );

    expect(order).toEqual(['thought:中文思考', 'transport_end:complete']);
    expect(outcome).toEqual({ kind: 'ended', event: transportEnd });
  });

  it('坏 JSON 是显式 transport failure，不能静默丢失业务事件', async () => {
    const { response } = createStreamingResponse('event: thought\ndata: {"type":"thought"\n\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );
    const onThought = vi.fn<(event: SSEThoughtEvent) => void>();
    const onTransportError = vi.fn<(event: ConversationTransportError) => void>();
    const onTransportEnd = vi.fn<(event?: SSETransportEndEvent) => void>();

    const outcome = await streamConversation(
      { conversation_id: 'conv-stream' },
      { onThought, onTransportError, onTransportEnd }
    );

    expect(onThought).not.toHaveBeenCalled();
    expect(onTransportError).toHaveBeenCalledOnce();
    const failure = onTransportError.mock.calls[0]?.[0];
    if (!failure || failure.source !== 'client') throw new Error('expected client transport error');
    expect(failure.kind).toBe('protocol');
    expect(failure.error.message).toContain('Invalid SSE JSON payload: event=thought');
    expect(onTransportEnd).toHaveBeenCalledWith();
    expect(outcome).toEqual({ kind: 'failed', failure });
  });

  it('未收到 transport_end 就 EOF 时按传输协议失败收尾', async () => {
    const thought = createSSEThoughtEvent('thought-before-eof', 'conv-stream', 'turn-before-eof', {
      delta: 'partial thought',
    });
    const { response } = createStreamingResponse(
      `event: thought\ndata: ${JSON.stringify(thought)}\n\n`
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );
    const onThought = vi.fn<(event: SSEThoughtEvent) => void>();
    const onTransportError = vi.fn<(event: ConversationTransportError) => void>();
    const onTransportEnd = vi.fn<(event?: SSETransportEndEvent) => void>();

    const outcome = await streamConversation(
      { conversation_id: 'conv-stream' },
      { onThought, onTransportError, onTransportEnd }
    );

    expect(onThought).toHaveBeenCalledOnce();
    expect(onTransportError).toHaveBeenCalledOnce();
    const failure = onTransportError.mock.calls[0]?.[0];
    if (!failure || failure.source !== 'client') throw new Error('expected client transport error');
    expect(failure.kind).toBe('protocol');
    expect(failure.errorCode).toBe('SSE_UNEXPECTED_EOF');
    expect(failure.retryable).toBe(true);
    expect(onTransportEnd).toHaveBeenCalledWith();
    expect(outcome).toEqual({ kind: 'failed', failure });
  });

  it('严格解析并按顺序分发 user_input_committed', async () => {
    const committed: ConversationUserInputCommittedEvent = {
      id: 'message-committed',
      type: 'user_input_committed',
      timestamp: 1000,
      conversation_id: 'conv-stream',
      turn_id: 'turn-committed',
      operation: 'append',
      content: '',
      raw_content: '',
      attachments: [
        {
          id: 'attachment-committed',
          kind: 'image',
          assetId: 'asset-committed',
          mediaType: 'image/png',
          byteLength: 128,
          width: 16,
          height: 8,
          sha256: 'a'.repeat(64),
        },
      ],
    };
    const { response } = createStreamingResponse(
      `event: user_input_committed\ndata: ${JSON.stringify(committed)}\n\n`
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );
    const onUserInputCommitted = vi.fn<(event: ConversationUserInputCommittedEvent) => void>();

    await streamConversation({ conversation_id: 'conv-stream' }, { onUserInputCommitted });

    expect(onUserInputCommitted).toHaveBeenCalledOnce();
    expect(onUserInputCommitted).toHaveBeenCalledWith(committed);
  });

  it('拒绝携带 draft 身份或未知字段的 commit ack', async () => {
    const invalidAck = {
      id: 'message-invalid',
      type: 'user_input_committed',
      timestamp: 1000,
      conversation_id: 'conv-stream',
      turn_id: 'turn-invalid',
      operation: 'append',
      content: '',
      raw_content: '',
      attachments: [{ draftId: 'draft-leak', kind: 'image' }],
    };
    const { response } = createStreamingResponse(
      `event: user_input_committed\ndata: ${JSON.stringify(invalidAck)}\n\n`
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );
    const onUserInputCommitted = vi.fn<(event: ConversationUserInputCommittedEvent) => void>();
    const onTransportError = vi.fn<(event: ConversationTransportError) => void>();

    await streamConversation(
      { conversation_id: 'conv-stream' },
      { onUserInputCommitted, onTransportError }
    );

    expect(onUserInputCommitted).not.toHaveBeenCalled();
    expect(onTransportError).toHaveBeenCalledOnce();
  });

  it('reader 异常中断时取消未完成的流并释放锁', async () => {
    const { response, reader } = createStreamingResponse();
    vi.spyOn(reader, 'read').mockRejectedValueOnce(new Error('reader failed'));
    const cancel = vi.spyOn(reader, 'cancel');
    const releaseLock = vi.spyOn(reader, 'releaseLock');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );
    const onTransportError = vi.fn<(e: ConversationTransportError) => void>();
    const onTransportEnd = vi.fn<(e?: SSETransportEndEvent) => void>();

    await streamConversation(
      { conversation_id: 'conv-stream' },
      { onTransportError, onTransportEnd }
    );

    expect(onTransportError).toHaveBeenCalledTimes(1);
    const failure = onTransportError.mock.calls[0]?.[0];
    if (!failure || failure.source !== 'client') throw new Error('expected client transport error');
    expect(failure.kind).toBe('network');
    expect(onTransportEnd).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it('合法 SSE 的业务回调失败时按流错误收尾，而不是误报为 JSON 解析失败', async () => {
    const thought = createSSEThoughtEvent(
      'thought-callback-failure',
      'conv-stream',
      'turn-callback-failure',
      { delta: 'thinking' }
    );
    const { response, reader } = createStreamingResponse(
      `event: thought\ndata: ${JSON.stringify(thought)}\n\n`
    );
    const cancel = vi.spyOn(reader, 'cancel');
    const releaseLock = vi.spyOn(reader, 'releaseLock');
    const parseWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );

    const onThought = vi.fn<(event: SSEThoughtEvent) => Promise<void>>(async () => {
      throw new Error('projection failed');
    });
    const teardownOrder: string[] = [];
    cancel.mockImplementation(async () => {
      teardownOrder.push('reader.cancel');
    });
    releaseLock.mockImplementation(() => {
      teardownOrder.push('reader.releaseLock');
    });
    const onTransportError = vi.fn<(event: ConversationTransportError) => void>(() => {
      teardownOrder.push('transport.error');
    });
    const onTransportEnd = vi.fn<(event?: SSETransportEndEvent) => void>(() => {
      teardownOrder.push('transport.end');
    });

    await streamConversation(
      { conversation_id: 'conv-stream' },
      { onThought, onTransportError, onTransportEnd }
    );

    expect(onThought).toHaveBeenCalledTimes(1);
    expect(onTransportError).toHaveBeenCalledTimes(1);
    const callbackFailure = onTransportError.mock.calls[0]?.[0];
    if (!callbackFailure || callbackFailure.source !== 'client')
      throw new Error('expected client transport error');
    expect(callbackFailure.kind).toBe('projection');
    expect(callbackFailure.error.message).toContain(
      'type=thought, id=thought-callback-failure, reason=projection failed'
    );
    expect(onTransportEnd).toHaveBeenCalledTimes(1);
    expect(parseWarning).not.toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse SSE data'),
      expect.anything(),
      expect.anything()
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(teardownOrder).toEqual([
      'reader.cancel',
      'reader.releaseLock',
      'transport.error',
      'transport.end',
    ]);
  });

  it('正式 summarization_error 事件必须分发，不能落入 default 静默丢弃', async () => {
    const event: SSESummarizationErrorEvent = {
      type: 'summarization_error',
      id: 'summary-error-1',
      summarization_id: 'summary-start-1',
      timestamp: 101,
      conversation_id: 'conv-stream',
      turn_id: 'turn-summary',
      run_id: RunIdSchema.parse('run-summary'),
      execution_id: 'execution-summary',
      error: 'summary failed',
    };
    const transportEnd = createSSETransportEndEvent(
      'end-summary-error',
      'conv-stream',
      'turn-summary',
      { execution_id: 'execution-summary', reason: 'complete' }
    );
    const { response } = createStreamingResponse(
      [
        `event: summarization_error\ndata: ${JSON.stringify(event)}\n\n`,
        `event: transport_end\ndata: ${JSON.stringify(transportEnd)}\n\n`,
      ].join('')
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );

    const onSummarizationError = vi.fn<(value: SSESummarizationErrorEvent) => void>();
    await streamConversation({ conversation_id: 'conv-stream' }, { onSummarizationError });

    expect(onSummarizationError).toHaveBeenCalledOnce();
    expect(onSummarizationError).toHaveBeenCalledWith(event);
  });

  it('请求取消后不得分发 reader 中残留的业务事件', async () => {
    const thought = createSSEThoughtEvent(
      'thought-after-abort',
      'conv-stream',
      'turn-after-abort',
      { delta: 'stale thinking' }
    );
    const { response, reader } = createStreamingResponse(
      `event: thought\ndata: ${JSON.stringify(thought)}\n\n`
    );
    const cancel = vi.spyOn(reader, 'cancel');
    const releaseLock = vi.spyOn(reader, 'releaseLock');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );

    const controller = new AbortController();
    controller.abort();
    const onThought = vi.fn<(event: SSEThoughtEvent) => void>();
    const onTransportEnd = vi.fn<(event?: SSETransportEndEvent) => void>();

    await streamConversation(
      { conversation_id: 'conv-stream' },
      { onThought, onTransportEnd },
      controller.signal
    );

    expect(onThought).not.toHaveBeenCalled();
    expect(onTransportEnd).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });
});
