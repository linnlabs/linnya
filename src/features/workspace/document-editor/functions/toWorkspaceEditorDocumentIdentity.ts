import type {
  WorkspaceEditorDocumentIdentity,
  WorkspaceEditorDocumentNode,
} from '../definitions/workspaceDocumentEditor';

export function toWorkspaceEditorDocumentIdentity(
  node: WorkspaceEditorDocumentNode,
): WorkspaceEditorDocumentIdentity {
  return {
    documentId: node.id,
    documentName: node.name,
    documentType: node.type,
    projectId: node.project_id,
  };
}
