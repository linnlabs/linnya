import { useInteractiveRunStore } from '../store/interactiveRunStore';
import { fetchActiveForegroundRun } from './interactiveRunApi';
import { projectActiveRunResponse } from '../functions/projectActiveRunResponse';

export async function reconcileInteractiveRunCommandFailure(
  conversationId: string,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const store = useInteractiveRunStore();
  const before = store.snapshotFor(conversationId);

  try {
    const activeRun = projectActiveRunResponse(await fetchActiveForegroundRun(conversationId));
    if (store.snapshotFor(conversationId) !== before) return;
    if (activeRun) {
      store.synchronizeSnapshot(conversationId, activeRun);
      store.recordCommandError(conversationId, message);
      return;
    }
  } catch (restoreError) {
    if (store.snapshotFor(conversationId) !== before) return;
    const restoreMessage =
      restoreError instanceof Error ? restoreError.message : String(restoreError);
    // 控制请求和查询同时断网时结果未知；保留原身份，由无 reader 观察流程继续对账。
    store.synchronizeSnapshot(conversationId, {
      ...before,
      conversationId,
      status: 'reconnecting',
      error: `${message}; active run query failed: ${restoreMessage}`,
    });
    return;
  }

  store.failRun(conversationId, message);
}
