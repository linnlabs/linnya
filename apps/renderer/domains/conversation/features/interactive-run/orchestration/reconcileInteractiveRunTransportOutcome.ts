import type { ConversationTransportOutcome } from '../../../definitions/conversationTransport';
import { projectRunSettlementResponse } from '../functions/projectRunSettlementResponse';
import { projectActiveRunResponse } from '../functions/projectActiveRunResponse';
import { useInteractiveRunStore } from '../store/interactiveRunStore';
import { fetchActiveForegroundRun, fetchForegroundRunSettlement } from './interactiveRunApi';

function describeTransportFailure(
  outcome: Extract<ConversationTransportOutcome, { kind: 'failed' }>
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
  outcome: ConversationTransportOutcome
): Promise<void> {
  const store = useInteractiveRunStore();
  if (!store.isLatestTransport(conversationId, controller)) return;
  store.releaseTransport(conversationId, controller);
  const current = store.snapshotFor(conversationId);
  if (outcome.kind !== 'failed' && current?.status !== 'paused') return;
  const failureMessage = outcome.kind === 'failed' ? describeTransportFailure(outcome) : undefined;
  const stillOwnsState = (): boolean =>
    store.isLatestTransport(conversationId, controller) &&
    store.snapshotFor(conversationId) === current;

  try {
    // 新消息尚未得到 run identity 时失败，原暂停 run 可能仍被 Host 完整保留。
    const snapshot = current?.runId
      ? projectRunSettlementResponse(
          await fetchForegroundRunSettlement(conversationId, current.runId),
          current
        )
      : projectActiveRunResponse(await fetchActiveForegroundRun(conversationId));
    if (!stillOwnsState()) return;
    if (!snapshot) {
      store.failRun(conversationId, failureMessage ?? 'Paused run is no longer available');
      return;
    }
    store.synchronizeSnapshot(conversationId, snapshot);
    if (!failureMessage) return;
    const settlementMessage =
      snapshot.error && snapshot.error !== failureMessage
        ? `${failureMessage}; run settlement: ${snapshot.error}`
        : failureMessage;
    store.recordCommandError(conversationId, settlementMessage);
  } catch (settlementError) {
    if (!stillOwnsState()) return;
    const settlementMessage =
      settlementError instanceof Error ? settlementError.message : String(settlementError);
    store.synchronizeSnapshot(conversationId, {
      ...current,
      conversationId,
      status: 'reconnecting',
      error: `${failureMessage ?? 'Unable to refresh paused run'}; run settlement query failed: ${settlementMessage}`,
    });
  }
}
