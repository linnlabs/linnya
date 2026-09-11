import { useInteractiveRunStore } from '../store/interactiveRunStore';
import { isInteractiveRunBusy } from '../functions/interactiveRunTransitions';
import { projectRunSettlementResponse } from '../functions/projectRunSettlementResponse';
import { projectActiveRunResponse } from '../functions/projectActiveRunResponse';
import { fetchActiveForegroundRun, fetchForegroundRunSettlement } from './interactiveRunApi';
import { reconcileTerminalConversationView } from '../../../services/orchestration/reconcileTerminalConversationView';

/** 没有 reader 时只观察 Backend；不暂停、不重新发送、不生成任何执行事实。 */
export async function observeDetachedInteractiveRun(conversationId: string): Promise<void> {
  const store = useInteractiveRunStore();
  const current = store.snapshotFor(conversationId);
  if (
    !current ||
    store.hasTransport(conversationId) ||
    (!isInteractiveRunBusy(current) && !(current.status === 'paused' && !current.pause?.settled)) ||
    current.status === 'awaiting_user'
  )
    return;
  try {
    const next = current.runId
      ? projectRunSettlementResponse(
          await fetchForegroundRunSettlement(conversationId, current.runId),
          current
        )
      : projectActiveRunResponse(await fetchActiveForegroundRun(conversationId));
    if (store.snapshotFor(conversationId) !== current || store.hasTransport(conversationId)) return;
    store.synchronizeSnapshot(conversationId, next);
    if (!next || !isInteractiveRunBusy(next) || next.status === 'awaiting_user') {
      await reconcileTerminalConversationView(conversationId);
    }
  } catch (error) {
    if (store.snapshotFor(conversationId) !== current || store.hasTransport(conversationId)) return;
    store.synchronizeSnapshot(conversationId, {
      ...current,
      status: 'reconnecting',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
