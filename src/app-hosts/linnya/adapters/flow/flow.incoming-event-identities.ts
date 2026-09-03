import type { ConversationNextRequest } from '@app/schemas';
import { generateRuntimeEventId } from '@linnlabs/linnkit/contracts';

/**
 * Flow 的请求构建、持久化和 runner history 必须共享同一批事件身份。
 * 身份只在编排入口补一次，禁止各消费方在缺 ID 时分别生成。
 */
export function assignIncomingEventIds(
  request: ConversationNextRequest,
  createId: () => string = generateRuntimeEventId,
): ConversationNextRequest {
  let changed = false;
  const newEvents = (request.new_events ?? []).map(event => {
    if (event.id !== undefined) {
      if (event.id.trim().length === 0 || event.id !== event.id.trim()) {
        throw new Error('[FlowOrchestrator] incoming event id 必须非空且不包含首尾空白');
      }
      return event;
    }

    changed = true;
    return {
      ...event,
      id: createId(),
    };
  });

  return changed
    ? { ...request, new_events: newEvents }
    : request;
}
