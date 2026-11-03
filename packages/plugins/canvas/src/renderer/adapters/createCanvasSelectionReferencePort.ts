import { addComposerReference, focusComposerInput } from '@plugin/renderer/composerCommandPort';
import { getWorkspaceNavigationPort } from '@plugin/renderer/workspaceNavigation';
import { CANVAS_DOCUMENT_TYPE } from '@plugin/canvas/shared';
import { readCanvasSelectionContext } from './readCanvasSelectionContext';
import { saveCanvasDocumentDrafts } from '../features/canvasDocument';
import { focusCanvasReference, type CanvasSelectionReferencePort } from '../features/conversationSelection';
export function createCanvasSelectionReferencePort(): CanvasSelectionReferencePort {
  return { save: documentId => saveCanvasDocumentDrafts(documentId, false), add: addComposerReference, focusComposer: focusComposerInput,
    read: readCanvasSelectionContext,
    async activate(metadata) {
      await getWorkspaceNavigationPort().openDocumentTarget({ documentId: metadata.documentId, type: CANVAS_DOCUMENT_TYPE, projectId: metadata.projectId });
      await focusCanvasReference(metadata.documentId, metadata.elementIds);
    },
  };
}
