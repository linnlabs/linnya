import {
  StorageSpaceGatewayError,
  type StorageSpaceGateway,
} from '../definitions/storageSpaceGateway';
import { storageSpaceGateway } from '../infrastructure/storageSpaceGateway';
import { useStorageSpaceStore, type StorageSpaceClearFailure } from '../store/storageSpaceStore';
import { reloadStorageSpaceOverviewAfterClear } from './loadStorageSpaceOverview';

const activeClearRequests = new WeakMap<object, Set<string>>();

function projectFailure(error: unknown): StorageSpaceClearFailure {
  if (!(error instanceof StorageSpaceGatewayError)) return 'failed';
  if (error.code === 'storage_space.conversation_not_found') return 'not_found';
  if (error.code === 'storage_space.conversation_deletion_in_progress') {
    return 'deletion_in_progress';
  }
  return 'failed';
}

export async function clearConversationWorkDirectory(input: {
  readonly conversationId: string;
  readonly confirmClear: () => Promise<boolean>;
  readonly gateway?: StorageSpaceGateway;
}): Promise<void> {
  const store = useStorageSpaceStore();
  const active = activeClearRequests.get(store) ?? new Set<string>();
  activeClearRequests.set(store, active);
  if (active.has(input.conversationId)) return;
  active.add(input.conversationId);

  try {
    if (!await input.confirmClear()) return;
    store.beginClear(input.conversationId);
    const gateway = input.gateway ?? storageSpaceGateway;
    await gateway.clearConversationWorkDirectory(input.conversationId);
    const refreshed = await reloadStorageSpaceOverviewAfterClear(gateway);
    if (refreshed) store.clearSucceeded(input.conversationId);
    else store.clearFailed(input.conversationId, 'failed');
  } catch (error: unknown) {
    store.clearFailed(input.conversationId, projectFailure(error));
  } finally {
    active.delete(input.conversationId);
    if (active.size === 0) activeClearRequests.delete(store);
  }
}
