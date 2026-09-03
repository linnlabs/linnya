import type {
  WorkspaceNodeTransferredEvent,
  WorkspaceNodeTransferRequest,
  WorkspaceNodeTransferResult,
} from '@app/schemas';
import {
  WorkspaceNodeTransferSaveError,
  type WorkspaceNodeTransferPort,
} from '@/shared/ports/workspaceNodeTransferPort';
import { workspaceGateway } from '@/shared/ipc/workspaceGateway';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { useWorkspaceTreeStore } from '@/domains/workspace/store/WorkspaceTreeStore';
import { WorkspaceOperationError } from '@/domains/workspace/definitions/workspaceOperationError';
import {
  deactivateIfActiveDocument,
  requestSave,
} from '@/domains/workspace/services/file-manager';
import { resolveCurrentWorkspaceMessage } from '@/domains/workspace/functions/resolveCurrentWorkspaceMessage';
import {
  flattenLoadedWorkspaceTree,
  reconcilePageSelectionAfterRemoval,
  refreshRemovedNodeParent,
} from './workspaceNodeRemoval';

const localTransferRootIds = new Set<string>();
const MAX_LOCAL_TRANSFER_ROOT_IDS = 512;

function markLocalTransferRoot(nodeId: string): void {
  localTransferRootIds.add(nodeId);
  if (localTransferRootIds.size <= MAX_LOCAL_TRANSFER_ROOT_IDS) return;
  const oldestNodeId = localTransferRootIds.values().next().value;
  if (typeof oldestNodeId === 'string') localTransferRootIds.delete(oldestNodeId);
}

async function inspectTransfer(
  request: WorkspaceNodeTransferRequest,
): Promise<WorkspaceNodeTransferResult> {
  const result = await workspaceGateway['inspect-node-transfer'](request);
  if (!result.success) throw new WorkspaceOperationError(result);
  return result.data;
}

async function executeTransfer(
  request: WorkspaceNodeTransferRequest,
): Promise<WorkspaceNodeTransferResult> {
  const result = await workspaceGateway['transfer-node'](request);
  if (!result.success) throw new WorkspaceOperationError(result);
  return result.data;
}

async function reconcileSourceProjectAfterTransfer(
  result: WorkspaceNodeTransferResult,
  nodesBeforeRemoval: ReturnType<typeof flattenLoadedWorkspaceTree>,
  activeDocumentId: string | null,
): Promise<void> {
  const removedNodeIds = new Set(result.movedNodeIds);
  if (activeDocumentId && removedNodeIds.has(activeDocumentId)) {
    await deactivateIfActiveDocument(activeDocumentId);
  }
  await refreshRemovedNodeParent(result.sourceParentId);
  await reconcilePageSelectionAfterRemoval({
    nodesBeforeRemoval,
    removedNodeIds,
    activeDocumentId,
    projectId: result.sourceProjectId,
  });
}

export async function handleWorkspaceNodeTransferredMutation(
  event: WorkspaceNodeTransferredEvent,
): Promise<void> {
  if (localTransferRootIds.delete(event.nodeId)) return;

  const currentProjectId = useWorkspaceScopeStore().currentProjectId;
  if (currentProjectId === event.targetProjectId) {
    await useWorkspaceTreeStore().reloadActiveProjectTree();
    return;
  }
  if (currentProjectId !== event.sourceProjectId) return;

  const treeStore = useWorkspaceTreeStore();
  const nodesBeforeRemoval = flattenLoadedWorkspaceTree(treeStore.projectTree);
  const activeDocumentId = useLayoutStore().state.activeDocument?.id ?? null;
  await reconcileSourceProjectAfterTransfer({
    nodeId: event.nodeId,
    nodeType: event.nodeType,
    nodeName: event.name,
    sourceProjectId: event.sourceProjectId,
    sourceParentId: event.sourceParentId,
    targetProjectId: event.targetProjectId,
    targetParentId: event.targetParentId,
    movedNodeIds: event.movedNodeIds,
  }, nodesBeforeRemoval, activeDocumentId);
}

export function createWorkspaceNodeTransfer(): WorkspaceNodeTransferPort {
  return {
    async transferNode(request): Promise<WorkspaceNodeTransferResult> {
      const inspection = await inspectTransfer(request);
      const treeStore = useWorkspaceTreeStore();
      const nodesBeforeRemoval = flattenLoadedWorkspaceTree(treeStore.projectTree);
      const activeDocumentId = useLayoutStore().state.activeDocument?.id ?? null;
      const activeDocumentWillMove = Boolean(
        activeDocumentId && inspection.movedNodeIds.includes(activeDocumentId),
      );

      if (activeDocumentWillMove) {
        const saved = await requestSave('view-switch');
        if (!saved) {
          throw new WorkspaceNodeTransferSaveError(
            resolveCurrentWorkspaceMessage('workspace.sidebar.node.transferSaveFailed'),
          );
        }
      }

      markLocalTransferRoot(request.nodeId);
      try {
        const result = await executeTransfer(request);
        await reconcileSourceProjectAfterTransfer(result, nodesBeforeRemoval, activeDocumentId);
        return result;
      } catch (error) {
        localTransferRootIds.delete(request.nodeId);
        throw error;
      }
    },
  };
}
