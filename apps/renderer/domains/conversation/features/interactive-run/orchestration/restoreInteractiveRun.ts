import { projectActiveRunResponse } from '../functions/projectActiveRunResponse';
import type { InteractiveRunSnapshot } from '../definitions/interactiveRun';
import { useInteractiveRunStore } from '../store/interactiveRunStore';
import { fetchActiveForegroundRun } from './interactiveRunApi';

export async function restoreInteractiveRun(
  conversationId: string
): Promise<InteractiveRunSnapshot | undefined> {
  const store = useInteractiveRunStore();
  const before = store.snapshotFor(conversationId);
  const response = await fetchActiveForegroundRun(conversationId);
  if (store.snapshotFor(conversationId) !== before) return store.snapshotFor(conversationId);
  const snapshot = projectActiveRunResponse(response);
  store.synchronizeSnapshot(conversationId, snapshot);
  return snapshot;
}
