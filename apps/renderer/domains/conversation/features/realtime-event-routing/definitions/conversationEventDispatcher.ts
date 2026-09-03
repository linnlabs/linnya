import type { SSEEvent } from 'linnkit/contracts';

import type { EventDispatchResult } from '../../../definitions/eventDispatch';
import type { ActivityBinding, UiSpec } from '../../../types';

/** 单次 assistant 请求把已校验 SSE 事实写入 conversation 投影的显式端口。 */
export type ConversationEventDispatcher = (
  conversationId: string,
  event: SSEEvent,
) => Promise<EventDispatchResult>;

export interface ConversationEventRouteContext {
  readonly ui?: UiSpec;
  readonly activity?: ActivityBinding;
}
