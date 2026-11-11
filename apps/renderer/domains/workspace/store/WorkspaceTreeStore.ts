/**
 * @file WorkspaceTreeStore.ts
 * @description Workspace 树的响应式状态与公开 action 门面。
 *
 * 异步加载和节点变更由 domain 的 tree.ts 运行入口装配；
 * Store 只持有状态、查询与同步 action，不反向创建编排。
 */

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type {
  WorkspaceNode,
  WorkspaceVfsRuntimeContext,
  WorkspaceNodePatch,
  WorkspaceNodeStatePatch,
} from '../definitions/workspaceTree';
import { flattenVisibleWorkspaceTree } from '../functions/flattenVisibleWorkspaceTree';
import { findNodeById, isDescendant } from '../shared/workspaceTreeState';

export type { WorkspaceNode } from '../definitions/workspaceTree';

export const useWorkspaceTreeStateStore = defineStore('workspace-tree', () => {
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

  function setProjectTree(nodes: WorkspaceNode[]): void { projectTree.value = nodes; }
  function setLoadedProjectId(id: string | null): void { loadedProjectId.value = id; }
  function setLoadingProjectId(id: string | null): void { loadingProjectId.value = id; }
  function setLoading(value: boolean): void { isLoading.value = value; }
  function setError(value: string | null): void { error.value = value; }
  function patchNode(node: WorkspaceNode, changes: WorkspaceNodePatch): void { Object.assign(node, changes); }
  function applyNodePatches(patches: readonly WorkspaceNodeStatePatch[]): void {
    for (const patch of patches) patchNode(patch.node, patch.changes);
  }

  return {
    projectTree,
    loadedProjectId,
    loadingProjectId,
    renameRequestNodeId,
    isLoading,
    error,
    newNodeFlags,
    flatProjectTree,
    vfsRuntimeContext,
    setProjectTree, setLoadedProjectId, setLoadingProjectId, setLoading, setError, patchNode, applyNodePatches,
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
