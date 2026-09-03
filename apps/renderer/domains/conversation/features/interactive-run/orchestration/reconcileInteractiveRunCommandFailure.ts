import { useInteractiveRunStore } from '../store/interactiveRunStore';
import { restoreInteractiveRun } from './restoreInteractiveRun';

export async function reconcileInteractiveRunCommandFailure(
  conversationId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const store = useInteractiveRunStore();

  try {
    const activeRun = await restoreInteractiveRun(conversationId);
    if (activeRun) {
      store.recordCommandError(conversationId, message);
      return;
    }
  } catch (restoreError) {
    const restoreMessage = restoreError instanceof Error
      ? restoreError.message
      : String(restoreError);
    store.failRun(conversationId, `${message}; active run query failed: ${restoreMessage}`);
    return;
  }

  store.failRun(conversationId, message);
}
