import type {
  WorkspaceMutationEvent,
  WorkspaceDocumentUpdatedEvent,
  WorkspaceNodeCreatedEvent,
  WorkspaceNodeDeletedEvent,
  WorkspaceNodeMovedEvent,
  WorkspaceNodeRenamedEvent,
  WorkspaceNodeTransferredEvent,
} from '@app/schemas';
import type { WorkspaceMutationEffectsPort } from '@/shared/ports/workspaceMutationEffectsPort';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { useWorkspaceTreeStore } from '@/domains/workspace/store/WorkspaceTreeStore';
import { notifyRendererDocumentMutationHandlers } from '@plugin/renderer/documentMutationPort';
import { applyPendingRevisionsToOpenMarkdownDocument } from './shared/markdownPendingRevisionRefresh';
import { resolveCurrentOpenDocument } from './resolveCurrentOpenDocument';
import { handleWorkspaceNodeDeletedMutation } from './workspaceNodeDeletion';
import { handleWorkspaceNodeTransferredMutation } from './workspaceNodeTransfer';

const handledDocumentMutationIds = new Set<string>();
const MAX_HANDLED_DOCUMENT_MUTATION_IDS = 512;

function markDocumentMutationHandled(mutationId: string): boolean {
  if (handledDocumentMutationIds.has(mutationId)) return false;
  handledDocumentMutationIds.add(mutationId);
  if (handledDocumentMutationIds.size > MAX_HANDLED_DOCUMENT_MUTATION_IDS) {
    const oldest = handledDocumentMutationIds.values().next().value;
    if (typeof oldest === 'string') {
      handledDocumentMutationIds.delete(oldest);
    }
  }
  return true;
}

function isCurrentProjectMutation(projectId: string | null): boolean {
  if (!projectId) return false;
  return useWorkspaceScopeStore().currentProjectId === projectId;
}

async function refreshParentOrRoot(parentId: string | null): Promise<void> {
  const treeStore = useWorkspaceTreeStore();
  if (!parentId) {
    await treeStore.reloadActiveProjectTree();
    return;
  }

  const parentNode = treeStore.findNodeById(parentId);
  if (!parentNode) {
    await treeStore.reloadActiveProjectTree();
    return;
  }

  await treeStore.loadNodeChildren(parentNode);
}

async function handleNodeCreated(event: WorkspaceNodeCreatedEvent): Promise<void> {
  if (!isCurrentProjectMutation(event.projectId)) return;
  const treeStore = useWorkspaceTreeStore();
  treeStore.markNodeAsNew(event.nodeId);
  await refreshParentOrRoot(event.parentId);
}

async function handleNodeRenamed(event: WorkspaceNodeRenamedEvent): Promise<void> {
  if (!isCurrentProjectMutation(event.projectId)) return;
  await refreshParentOrRoot(event.parentId);
}

async function handleNodeMoved(event: WorkspaceNodeMovedEvent): Promise<void> {
  if (!isCurrentProjectMutation(event.projectId)) return;
  await useWorkspaceTreeStore().refreshAfterMove(event.oldParentId, event.parentId);
}

async function handleNodeTransferred(event: WorkspaceNodeTransferredEvent): Promise<void> {
  await handleWorkspaceNodeTransferredMutation(event);
}

async function handleNodeDeleted(event: WorkspaceNodeDeletedEvent): Promise<void> {
  if (!isCurrentProjectMutation(event.projectId)) return;
  await handleWorkspaceNodeDeletedMutation(event);
}

async function handleDocumentUpdated(event: WorkspaceDocumentUpdatedEvent): Promise<void> {
  if (!isCurrentProjectMutation(event.projectId)) return;
  if (!markDocumentMutationHandled(event.mutationId)) return;

  const currentDocument = resolveCurrentOpenDocument();
  if (!currentDocument) return;
  if (currentDocument.documentId !== event.documentId) return;
  if (currentDocument.nodeType !== event.nodeType) return;

  if (event.nodeType === 'document' && event.mutationKind === 'pending') {
    await applyPendingRevisionsToOpenMarkdownDocument(event.documentId);
    return;
  }

  if (event.nodeType === 'document') return;

  await notifyRendererDocumentMutationHandlers({
    mutationId: event.mutationId,
    projectId: event.projectId,
    documentId: event.documentId,
    nodeType: event.nodeType,
    activeDocumentType: currentDocument.activeDocumentType,
    mutationKind: event.mutationKind,
    ...(event.versionNumber !== undefined ? { versionNumber: event.versionNumber } : {}),
  });
}

export function createWorkspaceMutationEffects(): WorkspaceMutationEffectsPort {
  return {
    async handleWorkspaceMutation(event: WorkspaceMutationEvent) {
      switch (event.type) {
        case 'workspace.node.created':
          await handleNodeCreated(event);
          return;
        case 'workspace.node.renamed':
          await handleNodeRenamed(event);
          return;
        case 'workspace.node.moved':
          await handleNodeMoved(event);
          return;
        case 'workspace.node.transferred':
          await handleNodeTransferred(event);
          return;
        case 'workspace.node.deleted':
          await handleNodeDeleted(event);
          return;
        case 'workspace.document.updated':
          await handleDocumentUpdated(event);
          return;
      }
    },
  };
}
