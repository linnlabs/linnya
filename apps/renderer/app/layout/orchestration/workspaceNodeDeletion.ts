import type { WorkspaceNodeDeletedEvent } from '@app/schemas';
import type {
  WorkspaceNodeDeletionPort,
  WorkspaceNodeDeletionResult,
  WorkspaceNodeDeletionTarget,
} from '@/shared/ports/workspaceNodeDeletionPort';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import { useWorkspaceSelectionStore } from '@/domains/workspace/store/WorkspaceSelectionStore';
import { useWorkspaceTreeStore } from '@/domains/workspace/store/WorkspaceTreeStore';
import { deactivateIfActiveDocument } from '@/domains/workspace/services/file-manager';
import type { PageSelectionNode } from '@/domains/workspace/features/page-selection-after-removal/definitions/pageSelectionAfterRemoval';
import {
  findRecentProjectPage,
  flattenLoadedWorkspaceTree,
  openWorkspacePage,
  reconcilePageSelectionAfterRemoval,
  refreshRemovedNodeParent,
} from './workspaceNodeRemoval';

const localDeletionRootIds = new Set<string>();
const MAX_LOCAL_DELETION_ROOT_IDS = 512;

function markLocalDeletionRoot(nodeId: string): void {
  localDeletionRootIds.add(nodeId);
  if (localDeletionRootIds.size <= MAX_LOCAL_DELETION_ROOT_IDS) return;
  const oldestNodeId = localDeletionRootIds.values().next().value;
  if (typeof oldestNodeId === 'string') localDeletionRootIds.delete(oldestNodeId);
}

function resolveDeletionProjectId(
  nodesBeforeDeletion: readonly PageSelectionNode[],
  targets: readonly WorkspaceNodeDeletionTarget[],
): string | null {
  for (const target of targets) {
    const node = nodesBeforeDeletion.find((candidate) => candidate.id === target.id);
    if (node) return node.projectId;
  }
  return useLayoutStore().state.activeDocument?.projectId ?? null;
}

function removeNestedDeletionTargets(
  targets: readonly WorkspaceNodeDeletionTarget[],
  nodesBeforeDeletion: readonly PageSelectionNode[],
): WorkspaceNodeDeletionTarget[] {
  const parentByNodeId = new Map(nodesBeforeDeletion.map((node) => [node.id, node.parentId]));
  const targetIds = new Set(targets.map((target) => target.id));
  return targets.filter((target) => {
    let parentId = parentByNodeId.get(target.id) ?? null;
    while (parentId) {
      if (targetIds.has(parentId)) return false;
      parentId = parentByNodeId.get(parentId) ?? null;
    }
    return true;
  });
}

export async function handleWorkspaceNodeDeletedMutation(
  event: WorkspaceNodeDeletedEvent,
): Promise<void> {
  if (localDeletionRootIds.delete(event.nodeId)) return;

  const treeStore = useWorkspaceTreeStore();
  const nodesBeforeDeletion = flattenLoadedWorkspaceTree(treeStore.projectTree);
  const activeDocumentId = useLayoutStore().state.activeDocument?.id ?? null;
  const deletedNodeIds = new Set(event.deletedNodeIds);

  if (activeDocumentId && deletedNodeIds.has(activeDocumentId)) {
    await deactivateIfActiveDocument(activeDocumentId);
  }
  await refreshRemovedNodeParent(event.parentId);
  if (!event.projectId) return;

  await reconcilePageSelectionAfterRemoval({
    nodesBeforeRemoval: nodesBeforeDeletion,
    removedNodeIds: deletedNodeIds,
    activeDocumentId,
    projectId: event.projectId,
  });
}

export function createWorkspaceNodeDeletion(): WorkspaceNodeDeletionPort {
  return {
    async deleteNodes(targets): Promise<WorkspaceNodeDeletionResult> {
      const deduplicatedTargets = Array.from(
        new Map(targets.map((target) => [target.id, target])).values(),
      );
      if (deduplicatedTargets.length === 0) {
        return { deletedNodeIds: [], failures: [] };
      }

      const treeStore = useWorkspaceTreeStore();
      const nodesBeforeDeletion = flattenLoadedWorkspaceTree(treeStore.projectTree);
      const uniqueTargets = removeNestedDeletionTargets(deduplicatedTargets, nodesBeforeDeletion);
      const activeDocumentId = useLayoutStore().state.activeDocument?.id ?? null;
      const projectId = resolveDeletionProjectId(nodesBeforeDeletion, uniqueTargets);
      const deletedNodeIds = new Set<string>();
      const failures: Array<{ nodeId: string; message: string }> = [];

      for (const target of uniqueTargets) {
        markLocalDeletionRoot(target.id);
        try {
          const deletedIds = await treeStore.deleteNode(target.id, target.parentId);
          deletedIds.forEach((nodeId) => deletedNodeIds.add(nodeId));
        } catch (error) {
          localDeletionRootIds.delete(target.id);
          failures.push({
            nodeId: target.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (deletedNodeIds.size > 0 && projectId) {
        if (activeDocumentId && deletedNodeIds.has(activeDocumentId)) {
          await deactivateIfActiveDocument(activeDocumentId);
        }
        await reconcilePageSelectionAfterRemoval({
          nodesBeforeRemoval: nodesBeforeDeletion,
          removedNodeIds: deletedNodeIds,
          activeDocumentId,
          projectId,
        });
      }

      return {
        deletedNodeIds: Array.from(deletedNodeIds),
        failures,
      };
    },

    async ensureProjectPageSelection(projectId) {
      const layoutStore = useLayoutStore();
      const activeDocument = layoutStore.state.activeDocument;
      if (activeDocument?.projectId === projectId) {
        useWorkspaceSelectionStore().selectSingle(activeDocument.id);
        return;
      }

      const candidate = await findRecentProjectPage(projectId, new Set());
      if (candidate) {
        await openWorkspacePage(candidate);
        return;
      }

      useWorkspaceSelectionStore().clearSelection();
      await getWorkspaceNavigationPort().openEmptyProjectFiles(projectId);
    },
  };
}
