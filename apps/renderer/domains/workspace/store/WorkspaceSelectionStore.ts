/**
 * @file WorkspaceSelectionStore.ts
 * @description 工作区节点选择管理 Store
 * 
 * 职责：
 * - 管理选中节点的集合（支持多选）
 * - 处理单选、多选（Ctrl/Cmd）、范围选择（Shift）
 * - 提供选中节点的计算属性
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Ref } from 'vue';
import { mergeOrderedSelectionRange } from '@/shared/selection';

interface SelectableTreeNode {
  id: string;
}

export const useWorkspaceSelectionStore = defineStore('workspace-selection', () => {
  // ==========================================================================
  // State
  // ==========================================================================

  /** 选中的节点 ID 集合 */
  const selectedNodeIds: Ref<Set<string>> = ref(new Set());

  /** 上一次选中的节点 ID（用于 Shift 范围选择） */
  const lastSelectedNodeId: Ref<string | null> = ref(null);

  // ==========================================================================
  // Actions
  // ==========================================================================

  /**
   * 单选节点
   */
  function selectSingle(nodeId: string): void {
    selectedNodeIds.value.clear();
    selectedNodeIds.value.add(nodeId);
    lastSelectedNodeId.value = nodeId;
  }

  /**
   * 切换节点选中状态（多选模式）
   */
  function toggleSelection(nodeId: string): void {
    if (selectedNodeIds.value.has(nodeId)) {
      selectedNodeIds.value.delete(nodeId);
    } else {
      selectedNodeIds.value.add(nodeId);
    }
    lastSelectedNodeId.value = nodeId;
  }

  /**
   * 范围选择（从上次选中的节点到当前节点）
   */
  function selectRange(flatTree: SelectableTreeNode[], endNodeId: string): void {
    if (!lastSelectedNodeId.value) {
      selectSingle(endNodeId);
      return;
    }

    const nextSelectedIds = mergeOrderedSelectionRange({
      selectedIds: selectedNodeIds.value,
      orderedIds: flatTree.map(node => node.id),
      anchorId: lastSelectedNodeId.value,
      targetId: endNodeId,
    });
    if (!nextSelectedIds) return;

    // 替换 Set 引用，确保依赖选择集合的视图只响应一次完整范围更新。
    selectedNodeIds.value = new Set(nextSelectedIds);
  }

  /**
   * 清空选择
   */
  function clearSelection(): void {
    selectedNodeIds.value.clear();
    lastSelectedNodeId.value = null;
  }

  /**
   * 检查节点是否被选中
   */
  function isSelected(nodeId: string): boolean {
    return selectedNodeIds.value.has(nodeId);
  }

  return {
    // State
    selectedNodeIds,
    lastSelectedNodeId,

    // Actions
    selectSingle,
    toggleSelection,
    selectRange,
    clearSelection,
    isSelected,
  };
});
