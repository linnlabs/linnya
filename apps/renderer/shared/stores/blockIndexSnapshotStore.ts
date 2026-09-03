/**
 * @file blockIndexSnapshotStore.ts
 * @description 前端块引用（ref）内存管理（Pinia Store）
 *
 * vNext 协议：维护「documentId + ref → blockId」的映射快照。
 *
 * 设计说明：
 * - ref 是从 blockId（UUID）确定性计算出的短引用（例如 #aZ3kP9）
 * - ref 可跨会话复现，不依赖 runId/index 快照
 * - 前端只需要在“准备发起 AI 请求”时把当前文档的 blockId 列表注册进来即可
 * - 之后收到 AI 返回的 ref（例如 #aZ3kP9），即可通过本 store 解析出真实 blockId
 *
 * 关键设计：
 * 1. 快照按 documentId 存储（前端单会话通常只编辑一个文档）
 * 2. 快照仅存于内存，页面刷新后丢失
 * 3. 新请求会覆盖同一文档的旧快照
 * 4. 支持可选的 TTL 超时机制，防止孤儿快照
 */

import { defineStore } from 'pinia';
import { generateRefId, normalizeRef } from '../utils/refIdGenerator';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * ref 快照结构（仅前端内存使用）
 */
export interface BlockRefSnapshot {
  documentId: string;
  createdAt: number;
  /**
   * 当前文档的 rootBlockId 列表快照。
   *
   * 说明：
   * - 解析 ref 时理论上只需要 refToBlockId；
   * - 但为了调试与可观测性（日志 sample / blocks 数量），这里保留一份 blockIds；
   * - 该字段必须与 register(documentId, blockIds) 的入参保持一致，否则会导致运行期异常。
   */
  blockIds: string[];
  /** ref -> blockId */
  refToBlockId: Map<string, string>;
}

/**
 * Store 状态
 */
interface BlockIndexSnapshotState {
  /**
   * 快照存储：key 为 documentId
   * 前端通常同时只编辑一个文档，所以简单用 documentId 作为 key
   */
  snapshots: Map<string, BlockRefSnapshot>;

  /**
   * TTL 超时时间（毫秒），默认 10 分钟
   */
  ttlMs: number;
}

// ============================================================================
// Pinia Store 定义
// ============================================================================

export const useBlockIndexSnapshotStore = defineStore('blockIndexSnapshot', {
  state: (): BlockIndexSnapshotState => ({
    snapshots: new Map(),
    ttlMs: 10 * 60 * 1000 // 10 分钟
  }),

  getters: {
    /**
     * 获取当前存储的快照数量
     */
    snapshotCount: (state) => state.snapshots.size
  },

  actions: {
    /**
     * 注册一个 ref 快照
     *
     * @param documentId - 文档 ID
     * @param blockIds - 当前文档的 blockId 列表（rootBlock.attrs.id）
     */
    async register(documentId: string, blockIds: string[]): Promise<void> {
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

      const snapshot: BlockRefSnapshot = {
        documentId,
        createdAt: Date.now(),
        // 重要：保留一份数组副本，避免外部对入参数组进行原地修改导致快照与日志不一致
        blockIds: [...blockIds],
        refToBlockId
      };

      this.snapshots.set(documentId, snapshot);
      console.log(
        `[blockIndexSnapshotStore] 注册 ref 快照: documentId=${documentId}, blocks=${blockIds.length}`
      );
    },

    /**
     * 获取指定文档的快照
     *
     * @param documentId - 文档 ID
     * @returns 快照对象，如果不存在或已过期则返回 null
     */
    get(documentId: string): BlockRefSnapshot | null {
      const snapshot = this.snapshots.get(documentId);

      if (!snapshot) {
        return null;
      }

      // 检查 TTL
      if (Date.now() - snapshot.createdAt > this.ttlMs) {
        console.log(`[blockIndexSnapshotStore] 快照已过期: documentId=${documentId}`);
        this.snapshots.delete(documentId);
        return null;
      }

      return snapshot;
    },

    /**
     * 通过 ref 查找对应的 blockId
     *
     * 这是最常用的查询场景：AI 返回 {documentId, ref}，需要映射到 blockId
     *
     * @param documentId - 文档 ID
     * @param ref - 块短引用 ID（例如 #aZ3kP9）
     * @returns blockId，如果找不到则返回 null
     */
    resolveBlockId(documentId: string, ref: string): string | null {
      const snapshot = this.get(documentId);
      if (!snapshot) {
        console.warn(`[blockIndexSnapshotStore] 未找到快照: documentId=${documentId}`);
        return null;
      }

      const normalized = normalizeRef(ref);
      const blockId = snapshot.refToBlockId.get(normalized);
      if (!blockId) {
        console.warn(`[blockIndexSnapshotStore] ref ${normalized} 不存在于 documentId=${documentId} 的快照中`);
        return null;
      }

      return blockId;
    },

    /**
     * 清除指定文档的快照
     *
     * @param documentId - 文档 ID
     */
    clear(documentId: string): void {
      this.snapshots.delete(documentId);
      console.log(`[blockIndexSnapshotStore] 清除快照: documentId=${documentId}`);
    },

    /**
     * 清除所有快照
     */
    clearAll(): void {
      const count = this.snapshots.size;
      this.snapshots.clear();
      console.log(`[blockIndexSnapshotStore] 清除所有快照: ${count} 个`);
    },

    /**
     * 清除所有过期的快照
     *
     * @returns 被清除的快照数量
     */
    clearExpired(): number {
      let count = 0;
      const now = Date.now();

      for (const [documentId, snapshot] of this.snapshots.entries()) {
        if (now - snapshot.createdAt > this.ttlMs) {
          this.snapshots.delete(documentId);
          count++;
        }
      }

      if (count > 0) {
        console.log(`[blockIndexSnapshotStore] 清除过期快照: ${count} 个`);
      }

      return count;
    },

    /**
     * 设置 TTL 超时时间
     *
     * @param ttlMs - 超时时间（毫秒）
     */
    setTtl(ttlMs: number): void {
      this.ttlMs = ttlMs;
    }
  }
});

// ============================================================================
// 便捷工具函数
// ============================================================================

/**
 * 注册 ref 快照的便捷函数（不需要先获取 store 实例）
 */
export async function registerBlockRefSnapshot(
  documentId: string,
  blockIds: string[]
): Promise<void> {
  await useBlockIndexSnapshotStore().register(documentId, blockIds);
}

/**
 * 解析 blockId 的便捷函数
 */
export function resolveBlockIdFromRefSnapshot(documentId: string, ref: string): string | null {
  return useBlockIndexSnapshotStore().resolveBlockId(documentId, ref);
}
