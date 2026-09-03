import type { ConversationTransportOutcome } from '../../definitions/conversationTransport';
import type { AssistantServiceCallbacks } from '../../types';

function transportFailureToError(outcome: Extract<ConversationTransportOutcome, { kind: 'failed' }>): Error {
  return outcome.failure.source === 'client'
    ? outcome.failure.error
    : new Error(outcome.failure.event.error);
}

/** 兼容非 Conversation 投影调用方；正式 Conversation 编排通过 typed outcome 自行收敛控制态。 */
export async function settleAssistantTransportOutcome(
  callbacks: AssistantServiceCallbacks,
  outcome: ConversationTransportOutcome,
): Promise<void> {
  if (callbacks.onTransportOutcome) {
    await callbacks.onTransportOutcome(outcome);
    return;
  }
  if (outcome.kind === 'failed') {
    await callbacks.onError?.(transportFailureToError(outcome));
  }
}
