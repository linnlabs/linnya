import { projectActiveRunResponse } from '../functions/projectActiveRunResponse';
import { useInteractiveRunStore } from '../store/interactiveRunStore';
import { requestForegroundRunPause } from './interactiveRunApi';
import { reconcileInteractiveRunCommandFailure } from './reconcileInteractiveRunCommandFailure';
import { reconcileTerminalConversationView } from '../../../services/orchestration/reconcileTerminalConversationView';

/** pause 等待 Backend 收口；关闭 reader 不能替代运行控制。 */
export async function pauseInteractiveRun(conversationId: string): Promise<void> {
  const store = useInteractiveRunStore();
  const current = store.snapshotFor(conversationId);
  if (
    !current?.runId ||
    !current.executionId ||
    (current.status !== 'running' && current.status !== 'starting')
  )
    return;
  store.synchronizeSnapshot(conversationId, { ...current, status: 'pausing' });
  try {
    const response = await requestForegroundRunPause(
      current.runId,
      conversationId,
      current.executionId
    );
    const latest = store.snapshotFor(conversationId);
    if (latest?.runId !== current.runId || latest.executionId !== current.executionId) return;
    store.abortTransport(conversationId);
    store.synchronizeSnapshot(conversationId, projectActiveRunResponse(response));
    await reconcileTerminalConversationView(conversationId);
  } catch (error) {
    if (store.snapshotFor(conversationId)?.executionId === current.executionId) {
      await reconcileInteractiveRunCommandFailure(conversationId, error);
    }
    throw error;
  }
}
