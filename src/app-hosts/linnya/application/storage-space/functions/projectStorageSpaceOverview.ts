import type {
  ManagedStorageInventory,
  StorageSpaceConversationUsage,
  StorageSpaceOverview,
} from '../definitions/storageSpace';

/** projection 只做稳定排序与总量一致性校验，不读取磁盘或数据库。 */
export function projectStorageSpaceOverview(input: {
  readonly measuredAtMs: number;
  readonly inventory: ManagedStorageInventory;
  readonly conversations: readonly StorageSpaceConversationUsage[];
}): StorageSpaceOverview {
  return Object.freeze({
    measuredAtMs: input.measuredAtMs,
    total: input.inventory.total,
    categories: input.inventory.categories,
    conversations: Object.freeze([...input.conversations].sort((left, right) => (
      // 未完成计量不是 0 B；它排在所有已知占用之后，再按最近活动稳定排序。
      (right.byteSize ?? -1) - (left.byteSize ?? -1)
      || right.lastEventAt - left.lastEventAt
      || (left.conversationId < right.conversationId ? -1 : 1)
    ))),
  });
}
