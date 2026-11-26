import {
  createServerSentEventFrameParser,
  validateSSEEvent,
  type SSEEvent,
  type ServerSentEventFrame,
} from '@linnlabs/linnkit/contracts';
import {
  GenerationStreamError,
  type GenerationErrorEvent,
  type GenerationTransportEndEvent,
} from '../definitions/generationStream';
import { resolveGenerationStreamFailure } from '../functions/resolveGenerationStreamFailure';

/**
 * Linnya 自有的会话事件，不在 Linnkit 的 SSE 合同里；生成请求不消费它，读到直接跳过。
 * 对话主链路（conversationService）对它单独校验，这里不重复。
 */
const IGNORED_LINNYA_EVENTS = new Set(['user_input_committed']);

/**
 * 读完一条 /conversation/next 的 SSE 响应，按顺序把已校验的事件交给 onEvent。
 *
 * 分帧交给 Linnkit 的 parser：event 行和 data 行可能落在不同的网络分块里，逐块拆行会丢事件名。
 * 读完后按收尾事实判断成败，失败时抛 GenerationStreamError；取消时抛 AbortError。
 */
export async function readGenerationEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal | null,
): Promise<void> {
  const reader = body.getReader();
  const parser = createServerSentEventFrameParser();
  let firstError: GenerationErrorEvent | undefined;
  let transportEnd: GenerationTransportEndEvent | undefined;
  let reachedEnd = false;

  const dispatch = (frame: ServerSentEventFrame): void => {
    const eventName = frame.event ?? 'message';
    if (IGNORED_LINNYA_EVENTS.has(eventName)) return;
    let payload: unknown;
    try {
      payload = JSON.parse(frame.data);
    } catch (error) {
      throw new GenerationStreamError(
        `Invalid SSE JSON payload for event=${eventName}: ${error instanceof Error ? error.message : String(error)}`,
        'protocol',
      );
    }
    const validation = validateSSEEvent(payload);
    if (!validation.success) {
      throw new GenerationStreamError(
        `Invalid SSE payload for event=${eventName}: ${validation.error.message}`,
        'protocol',
      );
    }
    const event = validation.data;
    if (event.type !== eventName) {
      throw new GenerationStreamError(
        `SSE event name/payload mismatch: event=${eventName}, payload=${event.type}`,
        'protocol',
      );
    }
    if ((event.type === 'error' || event.type === 'transport_error') && !firstError) {
      firstError = event;
    } else if (event.type === 'transport_end') {
      transportEnd = event;
    }
    onEvent(event);
  };

  try {
    while (true) {
      // 调用方按 AbortError 区分“用户取消”与失败；signal 带自定义 reason 时 throwIfAborted 会抛那个 reason，所以显式构造。
      if (signal?.aborted) throw new DOMException('Request aborted by user', 'AbortError');
      const { done, value } = await reader.read();
      if (done) {
        parser.finish().forEach(dispatch);
        reachedEnd = true;
        break;
      }
      parser.feed(value).forEach(dispatch);
    }
  } finally {
    if (!reachedEnd) {
      // 取消或协议错误后收回连接；收回失败不能盖过原来的错误，只记一条。
      await reader.cancel().catch((cleanupError: unknown) => {
        console.warn('[UnifiedAPI] 取消未读完的 SSE reader 失败:', cleanupError);
      });
    }
    reader.releaseLock();
  }

  const failure = resolveGenerationStreamFailure({ firstError, transportEnd });
  if (failure) throw failure;
}
