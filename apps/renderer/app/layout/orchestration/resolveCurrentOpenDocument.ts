import { getDocumentTypeByActiveType } from '@/app/plugins/registry';
import { useLayoutStore } from '../store/layoutStore';

export interface CurrentOpenDocument {
  readonly documentId: string;
  readonly projectId: string;
  readonly activeDocumentType: string;
  readonly nodeType: string;
}

export function resolveCurrentOpenDocument(): CurrentOpenDocument | null {
  const activeDocument = useLayoutStore().state.activeDocument;
  if (!activeDocument) return null;

  const documentType = getDocumentTypeByActiveType(activeDocument.type);
  if (!documentType) return null;

  return {
    documentId: activeDocument.id,
    projectId: activeDocument.projectId,
    activeDocumentType: activeDocument.type,
    nodeType: documentType.nodeType,
  };
}
