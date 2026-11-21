import type { DocumentPreviewTarget } from '../definitions/documentPreview';
import { DocumentPreviewUserError } from '../definitions/documentPreviewUserError';
import { resolveCurrentDocumentPreviewMessage } from './resolveCurrentDocumentPreviewMessage';
export function assertDocumentPreviewScope(
  target: DocumentPreviewTarget,
  currentProjectId: string | null
): void {
  if (target.projectId !== currentProjectId)
    throw new DocumentPreviewUserError(
      resolveCurrentDocumentPreviewMessage('documentPreview.error.outsideProject')
    );
}
