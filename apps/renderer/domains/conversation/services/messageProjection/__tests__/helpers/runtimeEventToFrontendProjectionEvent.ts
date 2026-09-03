import {
  runtimeEventToSSEEvent,
  type RuntimeEvent,
  type SSEExecutionScope,
} from 'linnkit/contracts';
import { shouldEmitRuntimeEventToSse } from 'linnkit/runtime-kernel/events';

import type { ProjectionEvent } from '../..';

/**
 * parity 门禁需要把历史事实投影到 Renderer live projector，以便与后端 durable read model 对拍。
 * 官方 SSE mapper 只负责实时 wire 语义，因此用户输入和历史摘要在这里补齐测试所需的历史 UI 语义。
 */
export function runtimeEventToFrontendProjectionEvent(
  event: RuntimeEvent,
  scope: SSEExecutionScope
): ProjectionEvent | null {
  if (event.type === 'user_input') {
    return event;
  }

  if (event.type === 'history_summary') {
    const projected = runtimeEventToSSEEvent(event);
    return projected ? { ...projected, ...scope } : null;
  }

  if (!shouldEmitRuntimeEventToSse(event)) return null;
  const sseEvent = runtimeEventToSSEEvent(event);
  return sseEvent ? { ...sseEvent, ...scope } : null;
}
