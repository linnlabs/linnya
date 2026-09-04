import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceMutationEvent } from '@app/schemas';
import { createWorkspaceMutationEffects } from './workspaceMutationEffects';

const mocks = vi.hoisted(() => ({
  currentProjectId: 'project-1',
  notifyDocumentMutationHandlers: vi.fn(async () => undefined),
  applyMarkdownPending: vi.fn(async () => undefined),
  synchronizeMarkdownAnnotations: vi.fn(async () => undefined),
  resolveCurrentOpenDocument: vi.fn(() => ({
    documentId: 'deck-1',
    projectId: 'project-1',
    activeDocumentType: 'slides',
    nodeType: 'presentation',
  })),
  reloadActiveProjectTree: vi.fn(async () => undefined),
  loadNodeChildren: vi.fn(async () => undefined),
  refreshAfterMove: vi.fn(async () => undefined),
  markNodeAsNew: vi.fn(),
  findNodeById: vi.fn(() => null),
  handleWorkspaceNodeDeletedMutation: vi.fn(async () => undefined),
  handleWorkspaceNodeTransferredMutation: vi.fn(async () => undefined),
}));

vi.mock('@/shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({ currentProjectId: mocks.currentProjectId }),
}));

vi.mock('@/domains/workspace/store/WorkspaceTreeStore', () => ({
  useWorkspaceTreeStore: () => ({
    reloadActiveProjectTree: mocks.reloadActiveProjectTree,
    loadNodeChildren: mocks.loadNodeChildren,
    refreshAfterMove: mocks.refreshAfterMove,
    markNodeAsNew: mocks.markNodeAsNew,
    findNodeById: mocks.findNodeById,
  }),
}));

vi.mock('@plugin/renderer/documentMutationPort', () => ({
  notifyRendererDocumentMutationHandlers: mocks.notifyDocumentMutationHandlers,
}));

vi.mock('./shared/markdownPendingRevisionRefresh', () => ({
  applyPendingRevisionsToOpenMarkdownDocument: mocks.applyMarkdownPending,
}));

vi.mock('./shared/markdownAnnotationRefresh', () => ({
  synchronizeAnnotationsToOpenMarkdownDocument: mocks.synchronizeMarkdownAnnotations,
}));

vi.mock('./resolveCurrentOpenDocument', () => ({
  resolveCurrentOpenDocument: mocks.resolveCurrentOpenDocument,
}));

vi.mock('./workspaceNodeDeletion', () => ({
  handleWorkspaceNodeDeletedMutation: mocks.handleWorkspaceNodeDeletedMutation,
}));

vi.mock('./workspaceNodeTransfer', () => ({
  handleWorkspaceNodeTransferredMutation: mocks.handleWorkspaceNodeTransferredMutation,
}));

function documentUpdatedEvent(overrides: Partial<WorkspaceMutationEvent> = {}): WorkspaceMutationEvent {
  return {
    type: 'workspace.document.updated',
    mutationId: 'mutation-default',
    projectId: 'project-1',
    documentId: 'deck-1',
    nodeType: 'presentation',
    mutationKind: 'version',
    versionNumber: 2,
    ...overrides,
  } as WorkspaceMutationEvent;
}

describe('workspaceMutationEffects document mutations', () => {
  beforeEach(() => {
    mocks.currentProjectId = 'project-1';
    mocks.reloadActiveProjectTree.mockClear();
    mocks.loadNodeChildren.mockClear();
    mocks.refreshAfterMove.mockClear();
    mocks.markNodeAsNew.mockClear();
    mocks.findNodeById.mockReset();
    mocks.findNodeById.mockReturnValue(null);
    mocks.handleWorkspaceNodeDeletedMutation.mockClear();
    mocks.handleWorkspaceNodeTransferredMutation.mockClear();
    mocks.notifyDocumentMutationHandlers.mockClear();
    mocks.applyMarkdownPending.mockClear();
    mocks.synchronizeMarkdownAnnotations.mockClear();
    mocks.resolveCurrentOpenDocument.mockReset();
    mocks.resolveCurrentOpenDocument.mockReturnValue({
      documentId: 'deck-1',
      projectId: 'project-1',
      activeDocumentType: 'slides',
      nodeType: 'presentation',
    });
  });

  it('dispatches matching plugin document version updates to renderer handlers', async () => {
    await createWorkspaceMutationEffects().handleWorkspaceMutation(documentUpdatedEvent({
      mutationId: 'mutation-plugin-version',
    }));

    expect(mocks.notifyDocumentMutationHandlers).toHaveBeenCalledWith({
      mutationId: 'mutation-plugin-version',
      projectId: 'project-1',
      documentId: 'deck-1',
      nodeType: 'presentation',
      activeDocumentType: 'slides',
      mutationKind: 'version',
      versionNumber: 2,
    });
  });

  it('dedupes repeated document mutations by mutationId', async () => {
    const event = documentUpdatedEvent({ mutationId: 'mutation-dedupe' });
    const effects = createWorkspaceMutationEffects();

    await effects.handleWorkspaceMutation(event);
    await effects.handleWorkspaceMutation(event);

    expect(mocks.notifyDocumentMutationHandlers).toHaveBeenCalledTimes(1);
  });

  it('keeps Markdown pending updates on the markdown pending refresh path', async () => {
    mocks.resolveCurrentOpenDocument.mockReturnValue({
      documentId: 'doc-1',
      projectId: 'project-1',
      activeDocumentType: 'editor',
      nodeType: 'document',
    });

    await createWorkspaceMutationEffects().handleWorkspaceMutation(documentUpdatedEvent({
      mutationId: 'mutation-markdown-pending',
      documentId: 'doc-1',
      nodeType: 'document',
      mutationKind: 'pending',
      versionNumber: undefined,
    }));

    expect(mocks.applyMarkdownPending).toHaveBeenCalledWith('doc-1');
    expect(mocks.notifyDocumentMutationHandlers).not.toHaveBeenCalled();
  });

  it('同步工具直接提交的 Markdown 批注，并在混合 mutation 后继续刷新 pending', async () => {
    mocks.resolveCurrentOpenDocument.mockReturnValue({
      documentId: 'doc-1',
      projectId: 'project-1',
      activeDocumentType: 'editor',
      nodeType: 'document',
    });

    await createWorkspaceMutationEffects().handleWorkspaceMutation(documentUpdatedEvent({
      mutationId: 'mutation-markdown-annotations',
      documentId: 'doc-1',
      nodeType: 'document',
      mutationKind: 'incremental',
    }));

    expect(mocks.synchronizeMarkdownAnnotations).toHaveBeenCalledWith('doc-1');
    expect(mocks.applyMarkdownPending).toHaveBeenCalledWith('doc-1');
    expect(mocks.notifyDocumentMutationHandlers).not.toHaveBeenCalled();
  });

  it('refreshes the workspace tree from node.created events', async () => {
    await createWorkspaceMutationEffects().handleWorkspaceMutation({
      type: 'workspace.node.created',
      mutationId: 'mutation-node-created',
      projectId: 'project-1',
      nodeId: 'doc-2',
      nodeType: 'document',
      parentId: null,
      name: 'Draft.md',
    });

    expect(mocks.markNodeAsNew).toHaveBeenCalledWith('doc-2');
    expect(mocks.reloadActiveProjectTree).toHaveBeenCalledTimes(1);
  });

  it('routes node deletion through the unified page-selection orchestration', async () => {
    const event: WorkspaceMutationEvent = {
      type: 'workspace.node.deleted',
      mutationId: 'mutation-node-deleted',
      projectId: 'project-1',
      nodeId: 'folder-1',
      nodeType: 'folder',
      parentId: null,
      name: 'Folder',
      deletedNodeIds: ['folder-1', 'doc-1'],
    };

    await createWorkspaceMutationEffects().handleWorkspaceMutation(event);

    expect(mocks.handleWorkspaceNodeDeletedMutation).toHaveBeenCalledWith(event);
  });

  it('routes cross-project transfer through the two-project orchestration', async () => {
    const event: WorkspaceMutationEvent = {
      type: 'workspace.node.transferred',
      mutationId: 'mutation-node-transferred',
      nodeId: 'folder-1',
      nodeType: 'folder',
      name: 'Folder',
      sourceProjectId: 'project-1',
      sourceParentId: null,
      targetProjectId: 'project-2',
      targetParentId: null,
      movedNodeIds: ['folder-1', 'doc-1'],
    };

    await createWorkspaceMutationEffects().handleWorkspaceMutation(event);

    expect(mocks.handleWorkspaceNodeTransferredMutation).toHaveBeenCalledWith(event);
  });
});
