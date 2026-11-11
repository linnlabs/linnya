import type { WorkspaceTreeLoader, WorkspaceTreeLoaderState } from '../definitions/workspaceTreeLoader';
import { workspaceGateway } from '@/shared/ipc/workspaceGateway';
import type {
  WorkspaceNode,
} from '@/domains/workspace/definitions/workspaceTree';
import { resolveCurrentWorkspaceMessage } from '@/domains/workspace/functions/resolveCurrentWorkspaceMessage';
import {
  readExpandedWorkspaceNodeIds,
  saveExpandedWorkspaceNodeIds,
} from '@/domains/workspace/shared/workspaceTreeExpansionState';
import {
  createNodeFromData,
  findNodeById,
  planNodeReconciliation,
} from '@/domains/workspace/shared/workspaceTreeState';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';

export function createWorkspaceTreeLoader(state: WorkspaceTreeLoaderState): WorkspaceTreeLoader {
  let latestLoadRequestId = 0;
  let activeLoadRequest: {
    projectId: string;
    requestId: number;
    promise: Promise<void>;
  } | null = null;

  function findLoadedNode(nodeId: string): WorkspaceNode | null {
    return findNodeById(state.projectTree, nodeId);
  }

  async function listVfsNodes(args: { projectId: string; parentId: string | null }) {
    const result = await workspaceGateway['list-vfs-nodes']({
      ...args,
      conversationId: state.vfsRuntimeContext.conversationId,
      instanceId: state.vfsRuntimeContext.instanceId ?? 'default',
    });
    if (result.success) return result;

    // 中文说明：旧数据库模式尚未提供 VFS 节点，兼容通道只在明确失败时退回真实节点列表。
    console.warn('[WorkspaceTreeLoader] list-vfs-nodes failed, fallback to list-nodes:', result.error);
    return workspaceGateway['list-nodes'](args);
  }

  async function loadNodeChildren(node: WorkspaceNode): Promise<void> {
    state.patchNode(node, { isLoading: true });
    try {
      const result = await listVfsNodes({ projectId: node.projectId, parentId: node.id });
      if (!result.success) throw new Error(result.error);

      const expandedIds = new Set(readExpandedWorkspaceNodeIds(node.projectId));
      const plan = planNodeReconciliation(node.children, result.data, node.depth + 1, expandedIds);
      state.applyNodePatches(plan.patches);
      state.patchNode(node, { children: plan.nodes });
      const expandedChildren = plan.nodes.filter(
        (child) => child.isExpanded && child.children === null,
      );
      await Promise.all(expandedChildren.map(loadNodeChildren));
    } catch (error: unknown) {
      console.error(`[WorkspaceTreeLoader] Failed to load children for node ${node.id}:`, error);
      state.patchNode(node, { children: [] });
    } finally {
      state.patchNode(node, { isLoading: false });
    }
  }

  async function loadProjectTree(projectId: string): Promise<void> {
    const requestId = latestLoadRequestId + 1;
    latestLoadRequestId = requestId;
    state.setLoading(true);
    state.setLoadingProjectId(projectId);
    state.setError(null);

    const promise = (async () => {
      const expandedIds = new Set(readExpandedWorkspaceNodeIds(projectId));
      try {
        const result = await listVfsNodes({ projectId, parentId: null });
        if (requestId !== latestLoadRequestId) return;
        if (!result.success) throw new Error(result.error);

        state.setProjectTree(result.data.map((node) => createNodeFromData(node, 0, expandedIds)));
        state.setLoadedProjectId(projectId);
        const expandedRoots = state.projectTree.filter(
          (node) => node.isExpanded && node.children === null,
        );
        await Promise.all(expandedRoots.map(loadNodeChildren));
      } catch (error: unknown) {
        if (requestId !== latestLoadRequestId) return;
        console.error(`[WorkspaceTreeLoader] Failed to load root nodes for project ${projectId}:`, error);
        state.setError(resolveCurrentWorkspaceMessage('workspace.sidebar.fileTree.loadFailed'));
        state.setProjectTree([]);
        state.setLoadedProjectId(null);
      } finally {
        if (requestId === latestLoadRequestId) {
          state.setLoading(false);
          state.setLoadingProjectId(null);
        }
        if (activeLoadRequest?.requestId === requestId) activeLoadRequest = null;
      }
    })();

    activeLoadRequest = { projectId, requestId, promise };
    await promise;
  }

  async function ensureProjectTreeLoaded(projectId: string): Promise<void> {
    if (state.loadedProjectId === projectId && !state.error) return;
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
    state.setLoading(true);
    state.setLoadingProjectId(projectId);
    state.setError(null);
    try {
      const result = await listVfsNodes({ projectId, parentId: null });
      if (requestId !== latestLoadRequestId) return;
      if (!result.success) throw new Error(result.error);

      const expandedIds = new Set(readExpandedWorkspaceNodeIds(projectId));
      const plan = planNodeReconciliation(state.projectTree, result.data, 0, expandedIds);
      state.applyNodePatches(plan.patches);
      state.setProjectTree(plan.nodes);
      state.setLoadedProjectId(projectId);
    } catch (error: unknown) {
      if (requestId !== latestLoadRequestId) return;
      console.error('[WorkspaceTreeLoader] Failed to reload root nodes:', error);
      state.setError(resolveCurrentWorkspaceMessage('workspace.sidebar.fileTree.loadFailed'));
      state.setProjectTree([]);
      state.setLoadedProjectId(null);
    } finally {
      if (requestId === latestLoadRequestId) {
        state.setLoading(false);
        state.setLoadingProjectId(null);
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
        state.patchNode(newParent, { isExpanded: true });
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

    state.patchNode(node, { isExpanded: !node.isExpanded });
    const expandedIds = new Set(readExpandedWorkspaceNodeIds(node.projectId));
    if (node.isExpanded) expandedIds.add(node.id);
    else expandedIds.delete(node.id);
    saveExpandedWorkspaceNodeIds(node.projectId, expandedIds);
  }

  function clearTree(): void {
    // 中文说明：清空树也要使在途请求失效，否则旧项目响应可能在切换后重新写回 Store。
    latestLoadRequestId += 1;
    activeLoadRequest = null;
    state.setProjectTree([]);
    state.setLoadedProjectId(null);
    state.setLoadingProjectId(null);
    state.setLoading(false);
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
