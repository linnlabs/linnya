import {
  deriveConversationWorkDirectoryIdentity,
  type ConversationWorkDirectoryUsagePort,
} from '../../../../../domains/conversation-files';
import type {
  ConversationCleanupUseCasePort,
} from '../../conversation-lifecycle';
import type {
  ConversationStorageCatalogPort,
} from '../definitions/conversationStorageCatalogPort';
import type {
  ManagedStorageInventoryPort,
} from '../definitions/managedStorageInventoryPort';
import type {
  StorageSpaceConversationUsage,
} from '../definitions/storageSpace';
import type {
  StorageSpaceUseCasePort,
} from '../definitions/storageSpaceUseCasePort';
import { projectStorageSpaceOverview } from '../functions/projectStorageSpaceOverview';

/**
 * 存储空间是跨 Conversation Files、SQLite catalog 和物理根的读取流程，因此留在
 * app-level use case；任何一个参与方都不需要知道设置页或其他 domain 的内部实现。
 */
export function createStorageSpaceUseCase(input: {
  readonly catalog: ConversationStorageCatalogPort;
  readonly inventory: ManagedStorageInventoryPort;
  readonly workDirectoryUsage: ConversationWorkDirectoryUsagePort;
  readonly cleanup: ConversationCleanupUseCasePort;
  readonly now?: () => number;
}): StorageSpaceUseCasePort {
  return Object.freeze({
    async readOverview() {
      const measuredAtMs = (input.now ?? Date.now)();
      const catalog = input.catalog.listAll();
      const conversations: StorageSpaceConversationUsage[] = [];
      for (const item of catalog) {
        // 顺序扫描避免大历史库一次打开成百上千个目录句柄；设置页不做自动刷新，
        // 因此这里优先使用稳定且有界的文件系统压力。
        try {
          const usage = await input.workDirectoryUsage.measureWorkDirectory(
            deriveConversationWorkDirectoryIdentity(item.conversationId),
          );
          conversations.push(Object.freeze({
            conversationId: item.conversationId,
            title: item.title,
            projectId: item.projectId,
            lastEventAt: item.lastEventAt,
            workFilesState: usage.state,
            byteSize: usage.byteSize,
            fileCount: usage.fileCount,
          }));
        } catch {
          // 单个目录被外部替换、锁定或拒绝访问时，不能伪装成 0 B，也不能拖垮其他
          // 对话和独立物理总盘点。底层错误不穿过 use case，只公开“本次未计量”。
          conversations.push(Object.freeze({
            conversationId: item.conversationId,
            title: item.title,
            projectId: item.projectId,
            lastEventAt: item.lastEventAt,
            workFilesState: 'unavailable',
            byteSize: null,
            fileCount: null,
          }));
        }
      }
      const inventory = await input.inventory.measure();
      return projectStorageSpaceOverview({ measuredAtMs, inventory, conversations });
    },
    clearConversationWorkDirectory: (conversationId: unknown) => (
      input.cleanup.requestWorkDirectoryClear(conversationId)
    ),
  });
}
