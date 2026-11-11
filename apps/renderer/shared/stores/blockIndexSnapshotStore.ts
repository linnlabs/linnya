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
import { normalizeRef } from '../utils/refIdGenerator';
import type {
  BlockRefSnapshot,
  BlockIndexSnapshotState,
} from '../block-references/definitions/blockRefSnapshot';

// ============================================================================
// 类型定义
// ============================================================================

// ============================================================================
// Pinia Store 定义
// ============================================================================

export const useBlockIndexSnapshotStore = defineStore('blockIndexSnapshot', {
  state: (): BlockIndexSnapshotState => ({
    snapshots: new Map(),
    ttlMs: 10 * 60 * 1000, // 10 分钟
  }),

  getters: {
    /**
     * 获取当前存储的快照数量
     */
    snapshotCount: state => state.snapshots.size,
  },

  actions: {
    /**
     * 注册一个 ref 快照
     *
     * @param documentId - 文档 ID
     * @param blockIds - 当前文档的 blockId 列表（rootBlock.attrs.id）
     */
    setSnapshot(snapshot: BlockRefSnapshot): void {
      this.snapshots.set(snapshot.documentId, snapshot);
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
        console.warn(
          `[blockIndexSnapshotStore] ref ${normalized} 不存在于 documentId=${documentId} 的快照中`
        );
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
    },
  },
});
