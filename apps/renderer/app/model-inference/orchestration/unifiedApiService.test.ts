import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSSEErrorEvent,
  createSSEFinalAnswerChunkEvent,
  createSSEFinalAnswerEvent,
  createSSETransportEndEvent,
  serializeServerSentEventFrame,
  type SSEEvent,
} from '@linnlabs/linnkit/contracts';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getApiBaseUrl: vi.fn(),
}));

vi.mock('../../../shared/services/aiService/common', () => mocks);
vi.mock('./determineModelId', () => ({ determineModelId: () => 'scripted-model' }));
vi.mock('../../../shared/stores/aiSettings', () => ({
  useAiSettingsStore: () => ({ isProgrammaticallyDisabled: false }),
}));
vi.mock('@/domains/model-configuration', () => ({ readPrimaryReasoningEffort: () => undefined }));

import { generateText, generateTextStream } from './unifiedApiService';

const conversationId = 'conversation-1';
const turnId = 'turn-1';
const encoder = new TextEncoder();

function chunk(seq: number, text: string): SSEEvent {
  return createSSEFinalAnswerChunkEvent(`chunk-${seq}`, conversationId, turnId, 'answer-1', seq, text);
}
function finalAnswer(content: string): SSEEvent {
  return createSSEFinalAnswerEvent('answer-1', conversationId, turnId, content, { completion_reason: 'terminal' });
}
function transportEnd(reason: 'complete' | 'error', reasonMessage?: string): SSEEvent {
  return createSSETransportEndEvent('end-1', conversationId, turnId, {
    execution_id: 'exec-1',
    reason,
    ...(reasonMessage ? { reason_message: reasonMessage } : {}),
  });
}
function runError(message: string): SSEEvent {
  return createSSEErrorEvent('error-1', conversationId, turnId, message, { error_code: 'llm.auth' });
}

/** 与 Backend writeSse 同形：每个事件一帧；pieces 指定把整段字节切成多少块送达。 */
function respondWith(events: readonly SSEEvent[], pieces = 1): void {
  const bytes = encoder.encode(
    events.map(event => serializeServerSentEventFrame({ event: event.type, data: JSON.stringify(event) })).join(''),
  );
  const size = Math.ceil(bytes.length / pieces);
  mocks.apiFetch.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += size) {
        controller.enqueue(bytes.slice(offset, offset + size));
      }
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
}

const request = { prompt: 'Title for: Plan the launch', conversationId, turn_id: turnId, persist: false };

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.getApiBaseUrl.mockResolvedValue('http://workspace.local');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('一次性生成 generateText', () => {
  it('Host 以 complete 收尾时返回最终回答；事件名与数据行被网络切开也不丢', async () => {
    respondWith([chunk(0, 'Launch'), chunk(1, ' plan'), finalAnswer('Launch plan'), transportEnd('complete')], 7);

    await expect(generateText(request)).resolves.toEqual({ generated_text: 'Launch plan' });
  });

  it('运行报错时抛出后端的错误信息，不返回空文字', async () => {
    respondWith([runError('Invalid API key'), transportEnd('error', 'Invalid API key')]);

    await expect(generateText(request)).rejects.toThrow('Invalid API key');
  });

  it('后端没收尾就关流（运行尚未接纳就失败）时抛错', async () => {
    respondWith([]);

    await expect(generateText(request)).rejects.toThrow('closed before transport_end');
  });
});

describe('流式生成 generateTextStream', () => {
  it('成功时逐段回调正文，收尾后回调一次 onStreamEnd', async () => {
    respondWith([chunk(0, 'Hello'), chunk(1, ' world'), finalAnswer('Hello world'), transportEnd('complete')], 5);
    const chunks: string[] = [];
    const onStreamEnd = vi.fn();
    const onError = vi.fn();

    await generateTextStream(request, { onTextChunk: text => chunks.push(text), onStreamEnd, onError });

    expect(chunks.join('')).toBe('Hello world');
    expect(onStreamEnd).toHaveBeenCalledTimes(1);
    expect(onStreamEnd.mock.calls[0]?.[0]).toMatchObject({ type: 'final_answer', content: 'Hello world' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('运行报错时回调 onError 并抛错，不回调 onStreamEnd', async () => {
    respondWith([chunk(0, 'Partial'), runError('Rate limited'), transportEnd('error', 'Rate limited')]);
    const onStreamEnd = vi.fn();
    const onError = vi.fn();

    await expect(generateTextStream(request, { onStreamEnd, onError })).rejects.toThrow('Rate limited');

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('Rate limited');
    expect(onStreamEnd).not.toHaveBeenCalled();
  });

  it('取消时抛 AbortError，不当成失败回调 onError', async () => {
    respondWith([chunk(0, 'Hello'), transportEnd('complete')]);
    const controller = new AbortController();
    controller.abort('user stopped');
    const onError = vi.fn();

    await expect(generateTextStream(request, { onError }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(onError).not.toHaveBeenCalled();
  });
});
