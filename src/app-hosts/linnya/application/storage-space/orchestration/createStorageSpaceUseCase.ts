import type { ConversationCleanupUseCasePort } from '../../conversation-lifecycle';
import type { ManagedStorageInventoryPort } from '../definitions/managedStorageInventoryPort';
import type { StorageSpaceUseCasePort } from '../definitions/storageSpaceUseCasePort';

/** 聚合盘点与精准清理由各自 owner 负责；概览不再读取对话目录清单。 */
export function createStorageSpaceUseCase(input: {
  readonly inventory: ManagedStorageInventoryPort;
  readonly cleanup: ConversationCleanupUseCasePort;
  readonly now?: () => number;
}): StorageSpaceUseCasePort {
  return Object.freeze({
    async readOverview() {
      const measuredAtMs = (input.now ?? Date.now)();
      const inventory = await input.inventory.measure();
      return Object.freeze({ measuredAtMs, total: inventory.total, categories: inventory.categories });
    },
    clearConversationWorkDirectory: (conversationId: unknown) => (
      input.cleanup.requestWorkDirectoryClear(conversationId)
    ),
  });
}
