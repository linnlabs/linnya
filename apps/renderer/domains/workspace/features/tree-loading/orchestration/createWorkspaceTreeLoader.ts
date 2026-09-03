import type { Ref } from 'vue';
import { workspaceGateway } from '@/shared/ipc/workspaceGateway';
import type {
  WorkspaceNode,
  WorkspaceVfsRuntimeContext,
} from '@/domains/workspace/definitions/workspaceTree';
import { resolveCurrentWorkspaceMessage } from '@/domains/workspace/functions/resolveCurrentWorkspaceMessage';
import {
  readExpandedWorkspaceNodeIds,
  saveExpandedWorkspaceNodeIds,
} from '@/domains/workspace/shared/workspaceTreeExpansionState';
import {
  createNodeFromData,
  findNodeById,
  reconcileNodeArrays,
} from '@/domains/workspace/shared/workspaceTreeState';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';

interface WorkspaceTreeLoaderState {
  readonly projectTree: Ref<WorkspaceNode[]>;
  readonly loadedProjectId: Ref<string | null>;
  readonly loadingProjectId: Ref<string | null>;
  readonly isLoading: Ref<boolean>;
  readonly error: Ref<string | null>;
  readonly vfsRuntimeContext: Ref<WorkspaceVfsRuntimeContext>;
}

export interface WorkspaceTreeLoader {
  loadProjectTree(projectId: string): Promise<void>;
  ensureProjectTreeLoaded(projectId: string): Promise<void>;
  reloadActiveProjectTree(): Promise<void>;
  loadNodeChildren(node: WorkspaceNode): Promise<void>;
  refreshAfterMove(oldParentId: string | null, newParentId: string | null): Promise<void>;
  toggleExpand(nodeId: string): Promise<void>;
  clearTree(): void;
}

export function createWorkspaceTreeLoader(state: WorkspaceTreeLoaderState): WorkspaceTreeLoader {
  let latestLoadRequestId = 0;
  let activeLoadRequest: {
    projectId: string;
    requestId: number;
    promise: Promise<void>;
  } | null = null;

  function findLoadedNode(nodeId: string): WorkspaceNode | null {
    return findNodeById(state.projectTree.value, nodeId);
  }

  async function listVfsNodes(args: { projectId: string; parentId: string | null }) {
    const result = await workspaceGateway['list-vfs-nodes']({
      ...args,
      conversationId: state.vfsRuntimeContext.value.conversationId,
      instanceId: state.vfsRuntimeContext.value.instanceId ?? 'default',
    });
    if (result.success) return result;

    // 中文说明：旧数据库模式尚未提供 VFS 节点，兼容通道只在明确失败时退回真实节点列表。
    console.warn('[WorkspaceTreeLoader] list-vfs-nodes failed, fallback to list-nodes:', result.error);
    return workspaceGateway['list-nodes'](args);
  }

  async function loadNodeChildren(node: WorkspaceNode): Promise<void> {
    node.isLoading = true;
    try {
      const result = await listVfsNodes({ projectId: node.projectId, parentId: node.id });
      if (!result.success) throw new Error(result.error);

      const expandedIds = new Set(readExpandedWorkspaceNodeIds(node.projectId));
      node.children = reconcileNodeArrays(node.children, result.data, node.depth + 1, expandedIds);
      const expandedChildren = node.children.filter(
        (child) => child.isExpanded && child.children === null,
      );
      await Promise.all(expandedChildren.map(loadNodeChildren));
    } catch (error: unknown) {
      console.error(`[WorkspaceTreeLoader] Failed to load children for node ${node.id}:`, error);
      node.children = [];
    } finally {
      node.isLoading = false;
    }
  }

  async function loadProjectTree(projectId: string): Promise<void> {
    const requestId = latestLoadRequestId + 1;
    latestLoadRequestId = requestId;
    state.isLoading.value = true;
    state.loadingProjectId.value = projectId;
    state.error.value = null;

    const promise = (async () => {
      const expandedIds = new Set(readExpandedWorkspaceNodeIds(projectId));
      try {
        const result = await listVfsNodes({ projectId, parentId: null });
        if (requestId !== latestLoadRequestId) return;
        if (!result.success) throw new Error(result.error);

        state.projectTree.value = result.data.map((node) => createNodeFromData(node, 0, expandedIds));
        state.loadedProjectId.value = projectId;
        const expandedRoots = state.projectTree.value.filter(
          (node) => node.isExpanded && node.children === null,
        );
        await Promise.all(expandedRoots.map(loadNodeChildren));
      } catch (error: unknown) {
        if (requestId !== latestLoadRequestId) return;
        console.error(`[WorkspaceTreeLoader] Failed to load root nodes for project ${projectId}:`, error);
        state.error.value = resolveCurrentWorkspaceMessage('workspace.sidebar.fileTree.loadFailed');
        state.projectTree.value = [];
        state.loadedProjectId.value = null;
      } finally {
        if (requestId === latestLoadRequestId) {
          state.isLoading.value = false;
          state.loadingProjectId.value = null;
        }
        if (activeLoadRequest?.requestId === requestId) activeLoadRequest = null;
      }
    })();

    activeLoadRequest = { projectId, requestId, promise };
    await promise;
  }

  async function ensureProjectTreeLoaded(projectId: string): Promise<void> {
    if (state.loadedProjectId.value === projectId && !state.error.value) return;
    if (activeLoadRequest?.projectId === projectId) {
      await activeLoadRequest.promise;
      return;
    }
    await loadProjectTree(projectId);
  }

  async function reloadActiveProjectTree(): Promise<void> {
    const projectId = useWorkspaceProjectsStore().activeProjectId;
    if (!projectId) return;

    const requestId = latestLoadRequestId + 1;
    latestLoadRequestId = requestId;
    activeLoadRequest = null;
    state.isLoading.value = true;
    state.loadingProjectId.value = projectId;
    state.error.value = null;
    try {
      const result = await listVfsNodes({ projectId, parentId: null });
      if (requestId !== latestLoadRequestId) return;
      if (!result.success) throw new Error(result.error);

      const expandedIds = new Set(readExpandedWorkspaceNodeIds(projectId));
      state.projectTree.value = reconcileNodeArrays(state.projectTree.value, result.data, 0, expandedIds);
      state.loadedProjectId.value = projectId;
    } catch (error: unknown) {
      if (requestId !== latestLoadRequestId) return;
      console.error('[WorkspaceTreeLoader] Failed to reload root nodes:', error);
      state.error.value = resolveCurrentWorkspaceMessage('workspace.sidebar.fileTree.loadFailed');
      state.projectTree.value = [];
      state.loadedProjectId.value = null;
    } finally {
      if (requestId === latestLoadRequestId) {
        state.isLoading.value = false;
        state.loadingProjectId.value = null;
      }
    }
  }

  async function refreshAfterMove(
    oldParentId: string | null,
    newParentId: string | null,
  ): Promise<void> {
    if (oldParentId) {
      const oldParent = findLoadedNode(oldParentId);
      if (oldParent) await loadNodeChildren(oldParent);
    } else {
      await reloadActiveProjectTree();
    }

    if (newParentId && newParentId !== oldParentId) {
      const newParent = findLoadedNode(newParentId);
      if (newParent) {
        newParent.isExpanded = true;
        await loadNodeChildren(newParent);
      }
    } else if (!newParentId && oldParentId) {
      await reloadActiveProjectTree();
    }
  }

  async function toggleExpand(nodeId: string): Promise<void> {
    const node = findLoadedNode(nodeId);
    if (!node || node.type !== 'folder') return;
    if (node.children === null) await loadNodeChildren(node);
    if (node.children === null) return;

    node.isExpanded = !node.isExpanded;
    const expandedIds = new Set(readExpandedWorkspaceNodeIds(node.projectId));
    if (node.isExpanded) expandedIds.add(node.id);
    else expandedIds.delete(node.id);
    saveExpandedWorkspaceNodeIds(node.projectId, expandedIds);
  }

  function clearTree(): void {
    // 中文说明：清空树也要使在途请求失效，否则旧项目响应可能在切换后重新写回 Store。
    latestLoadRequestId += 1;
    activeLoadRequest = null;
    state.projectTree.value = [];
    state.loadedProjectId.value = null;
    state.loadingProjectId.value = null;
    state.isLoading.value = false;
  }

  return {
    loadProjectTree,
    ensureProjectTreeLoaded,
    reloadActiveProjectTree,
    loadNodeChildren,
    refreshAfterMove,
    toggleExpand,
    clearTree,
  };
}
