import { validateSSEEvent, type SSEEvent } from '@linnlabs/linnkit/contracts';

import { createRequestEventTurnGate } from '../../../functions/requestEventTurnGate';
import type {
  ConversationEventDispatcher,
  ConversationEventRouteContext,
} from '../definitions/conversationEventDispatcher';

export interface CreateConversationRequestEventRouterInput {
  readonly conversationId: string;
  readonly signal: AbortSignal;
  readonly dispatcher?: ConversationEventDispatcher;
  readonly routeContext?: ConversationEventRouteContext;
}

function shouldInjectUi(context: ConversationEventRouteContext | undefined): boolean {
  return context?.ui !== undefined && context.ui.presentation !== 'hidden';
}

function applyRouteContext(
  event: SSEEvent,
  context: ConversationEventRouteContext | undefined,
): SSEEvent {
  const activity = context?.activity;
  const ui = shouldInjectUi(context) ? context?.ui : undefined;
  if (!activity && !ui) return event;

  const parsed = validateSSEEvent({
    ...event,
    metadata: {
      ...(event.metadata ?? {}),
      ...(ui ? { ui } : {}),
      ...(activity ? { activity } : {}),
    },
  });
  if (!parsed.success) {
    throw new Error(`Conversation request route context produced an invalid SSE event: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * 创建一次请求独享的事件路由器。
 *
 * 去重、turn gate、wait-user gate 和 AbortSignal 都属于当前 transport，不能提升到模块全局。
 */
export function createConversationRequestEventRouter(
  input: CreateConversationRequestEventRouterInput,
): (event: SSEEvent) => Promise<boolean> {
  const routedEventIds = new Set<string>();
  const acceptsRequestTurn = createRequestEventTurnGate();
  let awaitingUserInteraction = false;

  return async (event: SSEEvent): Promise<boolean> => {
    if (input.signal.aborted) return false;
    if (
      event.lane === 'auxiliary'
      || event.lane === 'child'
      || event.visibility === 'none'
      || event.visibility === 'parent-trace'
    ) return false;
    if (
      awaitingUserInteraction
      && event.type !== 'requires_user_interaction'
      && event.type !== 'run_execution_metrics'
      && event.type !== 'run_status'
      && event.type !== 'transport_end'
      && event.type !== 'error'
    ) return false;
    if (!input.dispatcher) return true;
    if (event.conversation_id !== input.conversationId) {
      throw new Error(
        `Conversation request received an event for another conversation: ${event.conversation_id} !== ${input.conversationId}`,
      );
    }
    if (!acceptsRequestTurn(event)) return false;
    if (routedEventIds.has(event.id)) return false;
    routedEventIds.add(event.id);

    const normalizedEvent = applyRouteContext(event, input.routeContext);
    const dispatchResult = await input.dispatcher(input.conversationId, normalizedEvent);
    if (!dispatchResult.success) {
      throw new Error(
        `Conversation event projection failed: type=${event.type}, id=${event.id}, reason=${dispatchResult.reason ?? 'unknown'}`,
      );
    }
    if (event.type === 'requires_user_interaction') {
      awaitingUserInteraction = true;
    }
    return true;
  };
}
