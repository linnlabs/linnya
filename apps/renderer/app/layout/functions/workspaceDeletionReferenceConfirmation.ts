import type { DocumentReferenceDeletionPreview } from '@app/schemas';
import type { AlertDialogSection } from '@linnya/renderer-ui';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';

export function workspaceDeletionReferenceConfirmation(preview: DocumentReferenceDeletionPreview, message: WorkspaceMessageResolver): { readonly riskMessage: string; readonly sections: readonly AlertDialogSection[] } {
  if (!preview.referenceCount) return { riskMessage: '', sections: [] };
  const items = preview.documents.map(document => document.title);
  if (preview.referencingDocumentCount > preview.documents.length) items.push(message('workspace.sidebar.node.referencesMore', { count: preview.referencingDocumentCount - preview.documents.length }));
  return { riskMessage: message('workspace.sidebar.node.referencesRisk', { documents: preview.referencingDocumentCount, references: preview.referenceCount }), sections: [{ title: message('workspace.sidebar.node.referencesTitle'), items }] };
}
