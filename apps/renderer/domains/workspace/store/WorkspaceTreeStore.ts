/**
 * @file WorkspaceTreeStore.ts
 * @description Workspace 树的响应式状态与公开 action 门面。
 *
 * 异步加载和节点变更流程分别归属 tree-loading、tree-node-mutations feature；
 * Store 只持有状态、同步 action，并在组合根注入依赖。
 */

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type {
  WorkspaceNode,
  WorkspaceVfsRuntimeContext,
} from '../definitions/workspaceTree';
import { flattenVisibleWorkspaceTree } from '../functions/flattenVisibleWorkspaceTree';
import { findNodeById, isDescendant } from '../shared/workspaceTreeState';
import { createWorkspaceTreeLoader } from '../features/tree-loading/orchestration/createWorkspaceTreeLoader';
import { createWorkspaceTreeNodeMutations } from '../features/tree-node-mutations/orchestration/createWorkspaceTreeNodeMutations';

export type { WorkspaceNode } from '../definitions/workspaceTree';

export const useWorkspaceTreeStore = defineStore('workspace-tree', () => {
  const projectTree = ref<WorkspaceNode[]>([]);
  const loadedProjectId = ref<string | null>(null);
  const loadingProjectId = ref<string | null>(null);
  const renameRequestNodeId = ref<string | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const newNodeFlags = ref<Record<string, boolean>>({});
  const vfsRuntimeContext = ref<WorkspaceVfsRuntimeContext>({
    conversationId: null,
    instanceId: 'default',
  });

  const flatProjectTree = computed(() => flattenVisibleWorkspaceTree(projectTree.value));

  function findNodeByIdInTree(nodeId: string): WorkspaceNode | null {
    return findNodeById(projectTree.value, nodeId);
  }

  function isDescendantInTree(
    potentialAncestorId: string,
    potentialDescendantId: string,
  ): boolean {
    return isDescendant(projectTree.value, potentialAncestorId, potentialDescendantId);
  }

  function setRenameRequestNodeId(nodeId: string | null): void {
    renameRequestNodeId.value = nodeId;
  }

  function markNodeAsNew(nodeId: string): void {
    if (!nodeId) return;
    newNodeFlags.value = { ...newNodeFlags.value, [nodeId]: true };
  }

  function clearNodeNewFlag(nodeId: string): void {
    if (!nodeId || !newNodeFlags.value[nodeId]) return;
    const nextFlags = { ...newNodeFlags.value };
    delete nextFlags[nodeId];
    newNodeFlags.value = nextFlags;
  }

  function isNodeNew(nodeId: string): boolean {
    return Boolean(nodeId && newNodeFlags.value[nodeId]);
  }

  function clearAllNewFlags(): void {
    newNodeFlags.value = {};
  }

  function setVfsRuntimeContext(context: Partial<WorkspaceVfsRuntimeContext>): void {
    vfsRuntimeContext.value = {
      conversationId: context.conversationId ?? vfsRuntimeContext.value.conversationId,
      instanceId: context.instanceId ?? vfsRuntimeContext.value.instanceId,
    };
  }

  const treeLoader = createWorkspaceTreeLoader({
    projectTree,
    loadedProjectId,
    loadingProjectId,
    isLoading,
    error,
    vfsRuntimeContext,
  });
  const nodeMutations = createWorkspaceTreeNodeMutations({
    error,
    findNodeById: findNodeByIdInTree,
    loadNodeChildren: treeLoader.loadNodeChildren,
    reloadActiveProjectTree: treeLoader.reloadActiveProjectTree,
    setRenameRequestNodeId,
    markNodeAsNew,
  });

  return {
    projectTree,
    loadedProjectId,
    loadingProjectId,
    renameRequestNodeId,
    isLoading,
    error,
    newNodeFlags,
    flatProjectTree,
    loadProjectTree: treeLoader.loadProjectTree,
    ensureProjectTreeLoaded: treeLoader.ensureProjectTreeLoaded,
    reloadActiveProjectTree: treeLoader.reloadActiveProjectTree,
    loadNodeChildren: treeLoader.loadNodeChildren,
    refreshAfterMove: treeLoader.refreshAfterMove,
    toggleExpand: treeLoader.toggleExpand,
    clearTree: treeLoader.clearTree,
    createFolder: nodeMutations.createFolder,
    createDocument: nodeMutations.createDocument,
    renameNode: nodeMutations.renameNode,
    duplicateNode: nodeMutations.duplicateNode,
    deleteNode: nodeMutations.deleteNode,
    setRenameRequestNodeId,
    markNodeAsNew,
    clearNodeNewFlag,
    clearAllNewFlags,
    setVfsRuntimeContext,
    findNodeById: findNodeByIdInTree,
    isDescendant: isDescendantInTree,
    isNodeNew,
  };
});
