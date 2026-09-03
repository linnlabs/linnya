import type { ConversationTransportOutcome } from '../../../definitions/conversationTransport';
import { projectRunSettlementResponse } from '../functions/projectRunSettlementResponse';
import { useInteractiveRunStore } from '../store/interactiveRunStore';
import { fetchForegroundRunSettlement } from './interactiveRunApi';

function describeTransportFailure(
  outcome: Extract<ConversationTransportOutcome, { kind: 'failed' }>,
): string {
  return outcome.failure.source === 'client'
    ? outcome.failure.error.message
    : outcome.failure.event.error;
}

/**
 * transport owner 已释放 reader 后的 Interactive Run 控制面收敛。
 * 这里只同步 Host read model，不生成或回放任何 RuntimeEvent。
 */
export async function reconcileInteractiveRunTransportOutcome(
  conversationId: string,
  controller: AbortController,
  outcome: ConversationTransportOutcome,
): Promise<void> {
  const store = useInteractiveRunStore();
  store.releaseTransport(conversationId, controller);
  if (outcome.kind !== 'failed') return;

  const failureMessage = describeTransportFailure(outcome);
  const current = store.snapshotFor(conversationId);
  if (!current?.runId) {
    store.failRun(conversationId, failureMessage);
    return;
  }

  try {
    const response = await fetchForegroundRunSettlement(conversationId, current.runId);
    const snapshot = projectRunSettlementResponse(response, current);
    if (!snapshot) {
      store.failRun(conversationId, failureMessage);
      return;
    }
    store.synchronizeSnapshot(conversationId, snapshot);
    const settlementMessage = snapshot.error && snapshot.error !== failureMessage
      ? `${failureMessage}; run settlement: ${snapshot.error}`
      : failureMessage;
    store.recordCommandError(conversationId, settlementMessage);
  } catch (settlementError) {
    const settlementMessage = settlementError instanceof Error
      ? settlementError.message
      : String(settlementError);
    store.failRun(
      conversationId,
      `${failureMessage}; run settlement query failed: ${settlementMessage}`,
    );
  }
}
