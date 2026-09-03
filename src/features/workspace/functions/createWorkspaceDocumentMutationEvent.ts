import { v4 as uuidv4 } from 'uuid';
import type {
  WorkspaceDocumentMutationKind,
  WorkspaceDocumentUpdatedEvent,
  WorkspaceMutationSource,
} from '@app/schemas';

export interface WorkspaceMutationDocumentSnapshot {
  readonly id: string;
  readonly project_id: string | null;
  readonly type: string;
}

export function createWorkspaceDocumentUpdatedEvent(params: {
  readonly node: WorkspaceMutationDocumentSnapshot;
  readonly mutationKind: WorkspaceDocumentMutationKind;
  readonly versionNumber?: number;
  readonly source?: WorkspaceMutationSource;
}): WorkspaceDocumentUpdatedEvent {
  return {
    type: 'workspace.document.updated',
    mutationId: uuidv4(),
    projectId: params.node.project_id,
    documentId: params.node.id,
    nodeType: params.node.type,
    mutationKind: params.mutationKind,
    ...(params.versionNumber !== undefined ? { versionNumber: params.versionNumber } : {}),
    ...(params.source ? { source: params.source } : {}),
  };
}
