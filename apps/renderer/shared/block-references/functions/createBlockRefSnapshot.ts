import { generateRefId, normalizeRef } from '../../utils/refIdGenerator';
import type { BlockRefSnapshot } from '../definitions/blockRefSnapshot';

/** 先完成全部 ref 计算和碰撞检查，成功后才能一次提交快照。 */
export async function createBlockRefSnapshot(
  documentId: string,
  blockIds: string[]
): Promise<BlockRefSnapshot> {
  const refToBlockId = new Map<string, string>();

  for (const blockId of blockIds) {
    const ref = await generateRefId(blockId);
    const normalized = normalizeRef(ref);

    const existed = refToBlockId.get(normalized);
    if (existed && existed !== blockId) {
      // 极低概率事件：同一文档内 ref 碰撞
      throw new Error(
        `[blockIndexSnapshotStore] ref 碰撞：${normalized} 同时对应多个 blockId（${existed}, ${blockId}）。请增大 ref 长度或联系开发者。`
      );
    }
    refToBlockId.set(normalized, blockId);
  }

  return {
    documentId,
    createdAt: Date.now(),
    // 重要：保留一份数组副本，避免外部对入参数组进行原地修改导致快照与日志不一致
    blockIds: [...blockIds],
    refToBlockId,
  };
}
