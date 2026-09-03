import { projectActiveRunResponse } from '../functions/projectActiveRunResponse';
import type { InteractiveRunSnapshot } from '../definitions/interactiveRun';
import { useInteractiveRunStore } from '../store/interactiveRunStore';
import { fetchActiveForegroundRun } from './interactiveRunApi';

export async function restoreInteractiveRun(
  conversationId: string,
): Promise<InteractiveRunSnapshot | undefined> {
  const response = await fetchActiveForegroundRun(conversationId);
  const snapshot = projectActiveRunResponse(response);
  useInteractiveRunStore().synchronizeSnapshot(
    conversationId,
    snapshot,
  );
  return snapshot;
}
