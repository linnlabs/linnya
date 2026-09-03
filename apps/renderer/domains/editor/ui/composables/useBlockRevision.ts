/**
 * useBlockRevision.ts
 *
 * 修订模式状态与操作
 * - 修订状态计算
 * - 修订统计（插入/删除数量）
 * - 接受/拒绝修订操作
 *
 * 架构改进：
 * - hasPendingRevision 优先从 canonical session 派生（不受虚拟化影响）
 * - blockRevisionState 仍需 enabled 守卫（涉及 doc mark 扫描，仅可见时执行）
 */

import { computed, unref, watch, type ComputedRef, type Ref } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import { useRevisionStore, type RevisionStore, type BlockRevisionState } from '../../features/Revision/store/useRevisionStore';
import { getFlag } from '../services/editorFeatureFlags';

// ==================== 类型定义 ====================

export interface BlockRevisionProps {
  editor: Editor;
  blockId: string | null;
}

export interface RevisionDiffStats {
  insertCount: number;
  deleteCount: number;
}

export interface RevisionToolbarPosition {
  top: number;
  left: number;
}

export interface UseBlockRevisionOptions {
  props: BlockRevisionProps | Ref<BlockRevisionProps> | ComputedRef<BlockRevisionProps>;
  enabled?: ComputedRef<boolean>;
}

export interface UseBlockRevisionReturn {
  /** 当前块的修订状态 */
  blockRevisionState: ComputedRef<BlockRevisionState | null>;
  /** 是否有待处理的修订 */
  hasPendingRevision: ComputedRef<boolean>;
  /** 修订统计（插入/删除数量） */
  revisionDiffStats: ComputedRef<RevisionDiffStats>;
  /** 修订工具栏位置 */
  revisionToolbarPosition: ComputedRef<RevisionToolbarPosition>;
  /** 接受当前块的所有修订 */
  handleAcceptAllRevisions: () => Promise<void>;
  /** 拒绝当前块的所有修订 */
  handleRejectAllRevisions: () => Promise<void>;
}

// ==================== Composable 实现 ====================

export function useBlockRevision(options: UseBlockRevisionOptions): UseBlockRevisionReturn {
  const { props, enabled } = options;
  const resolvedProps = computed<BlockRevisionProps>(() => unref(props));

  // ==================== Store 获取 ====================

  const revisionStore = computed<RevisionStore | null>(() => {
    const currentProps = resolvedProps.value;
    if (!currentProps.editor) return null;
    return useRevisionStore(currentProps.editor);
  });

  const blockId = computed<string | null>(() => resolvedProps.value.blockId);

  watch(
    [
      blockId,
      computed(() => enabled?.value ?? true),
      computed(() => {
        const id = blockId.value;
        return id != null && revisionStore.value?.hasCanonicalPending(id) === true;
      }),
    ],
    ([currentBlockId, isEnabled, hasCanonical]) => {
      if (!currentBlockId || !isEnabled || !hasCanonical) return;
      if (revisionStore.value?.getRevisionState(currentBlockId)) return;
      void revisionStore.value?.projectPendingRevisionsForBlocks([currentBlockId]);
    },
    { immediate: true }
  );

  // ==================== 计算属性 ====================

  /** 当前块的修订状态（涉及 doc mark 扫描，仅 enabled 时执行） */
  const blockRevisionState = computed<BlockRevisionState | null>(() => {
    if (enabled && !enabled.value) return null;
    if (!revisionStore.value) return null;
    if (!blockId.value) return null;
    return revisionStore.value.getRevisionState?.(blockId.value) || null;
  });

  /**
   * 是否有待处理的修订
   *
   * 优先从 canonical session 派生（不受虚拟化影响，不触发 doc mark 扫描）。
   * 可见时兜底检查 mark 投影层（用于 undo/redo 后的状态恢复）。
   */
  const hasPendingRevision = computed<boolean>(() => {
    if (!revisionStore.value) return false;
    const blockId = resolvedProps.value.blockId;
    if (!blockId) return false;
    // canonical session 是唯一事实源，不依赖块可见性
    if (revisionStore.value.hasCanonicalPending(blockId)) return true;
    // 可见时兜底检查 mark 投影层（覆盖 undo/redo 恢复场景）
    if (enabled && !enabled.value) return false;
    return revisionStore.value.hasPendingRevision(blockId);
  });

  /** 修订统计 */
  const revisionDiffStats = computed<RevisionDiffStats>(() => {
    return blockRevisionState.value?.diffStats || { insertCount: 0, deleteCount: 0 };
  });

  const revisionToolbarPosition = computed<RevisionToolbarPosition>(() => {
    return { top: 24, left: 0 };
  });

  // ==================== 操作方法 ====================

  const handleAcceptAllRevisions = async (): Promise<void> => {
    if (!revisionStore.value || !hasPendingRevision.value) return;

    const blockId = resolvedProps.value.blockId;
    if (!blockId) return;
    try {
      await revisionStore.value.acceptAllRevisions(blockId);
      if (getFlag('revisionDebugLogging')) {
        console.log('[useBlockRevision] 已接受所有修订:', blockId);
      }
    } catch (error) {
      console.error('[useBlockRevision] 接受修订失败:', error);
    }
  };

  const handleRejectAllRevisions = async (): Promise<void> => {
    if (!revisionStore.value || !hasPendingRevision.value) return;

    const blockId = resolvedProps.value.blockId;
    if (!blockId) return;
    try {
      await revisionStore.value.rejectAllRevisions(blockId);
      if (getFlag('revisionDebugLogging')) {
        console.log('[useBlockRevision] 已拒绝所有修订:', blockId);
      }
    } catch (error) {
      console.error('[useBlockRevision] 拒绝修订失败:', error);
    }
  };

  return {
    blockRevisionState,
    hasPendingRevision,
    revisionDiffStats,
    revisionToolbarPosition,
    handleAcceptAllRevisions,
    handleRejectAllRevisions,
  };
}
