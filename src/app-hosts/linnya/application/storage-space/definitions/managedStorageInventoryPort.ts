import type { ManagedStorageInventory } from './storageSpace';

/** 只读物理盘点 port；不得创建、清理或修复任何受管目录。 */
export interface ManagedStorageInventoryPort {
  measure(): Promise<ManagedStorageInventory>;
}
