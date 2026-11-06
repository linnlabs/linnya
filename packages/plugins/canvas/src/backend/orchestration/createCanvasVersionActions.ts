import { readCanvasDocumentIdentity } from '../features/canvasDocument';
import type { CanvasVersionActionsOptions } from '../definitions/canvasVersionActions';
import { createCanvasVersionRestorationAction } from './createCanvasVersionRestorationAction';
export function createCanvasVersionActions(input: CanvasVersionActionsOptions) {
  function list(documentId: string) {
    readCanvasDocumentIdentity(input.database, documentId);
    input.versions.initialize(documentId);
    return input.versions.list(documentId);
  }
  function preview(documentId: string, versionId: string) {
    readCanvasDocumentIdentity(input.database, documentId);
    input.versions.initialize(documentId);
    return input.versions.preview(documentId, versionId);
  }
  function budget(documentId: string) {
    readCanvasDocumentIdentity(input.database, documentId);
    input.versions.initialize(documentId);
    return input.versions.budgetStatus(documentId);
  }
  const restore = createCanvasVersionRestorationAction({ ...input, list });
  return { list, preview, restore, budget };
}
