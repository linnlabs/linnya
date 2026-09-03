import type { ToolObservationPreviewMeta } from 'linnkit/runtime-kernel';

export function buildWorkspaceObservationPreviewMeta(params: {
  documentName: string;
  docType: string;
}): Required<Pick<ToolObservationPreviewMeta, 'document_name' | 'doc_type'>> {
  const documentName = params.documentName.trim();
  const docType = params.docType.trim();
  if (!documentName || !docType) {
    throw new Error('Workspace observation preview metadata requires documentName and docType');
  }

  return {
    document_name: documentName,
    doc_type: docType,
  };
}
