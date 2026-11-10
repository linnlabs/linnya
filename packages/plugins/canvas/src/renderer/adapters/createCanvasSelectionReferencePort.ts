import { addComposerReference, focusComposerInput } from '@plugin/renderer/composerCommandPort';
import { getWorkspaceNavigationPort } from '@plugin/renderer/workspaceNavigation';
import { getCurrentWorkspaceProjectId } from '@plugin/renderer/workspaceRuntime';
import { CANVAS_DOCUMENT_TYPE } from '@plugin/canvas/shared';
import { readCanvasSelectionContext } from './readCanvasSelectionContext';
import { saveCanvasDocumentDrafts } from '../features/canvasDocument';
import {
  focusCanvasReference,
  type CanvasSelectionReferencePort,
} from '../features/conversationSelection';
import { canvasText } from '../features/localization';
export function createCanvasSelectionReferencePort(): CanvasSelectionReferencePort {
  return {
    save: documentId => saveCanvasDocumentDrafts(documentId, false),
    add: addComposerReference,
    focusComposer: focusComposerInput,
    read: readCanvasSelectionContext,
    async activate(metadata) {
      const projectId = getCurrentWorkspaceProjectId();
      if (projectId !== metadata.projectId)
        throw new Error(canvasText('canvas.error.referenceOutsideProject'));
      // 选区正文可能已删除，但画布归属必须仍有效；不能按旧metadata切回已移出的文档。
      await readCanvasSelectionContext({
        documentId: metadata.documentId,
        elementIds: metadata.elementIds,
        projectId,
      });
      if (getCurrentWorkspaceProjectId() !== projectId)
        throw new Error(canvasText('canvas.error.projectSwitched'));
      await getWorkspaceNavigationPort().openDocumentTarget({
        documentId: metadata.documentId,
        type: CANVAS_DOCUMENT_TYPE,
        projectId: metadata.projectId,
      });
      await focusCanvasReference(metadata.documentId, metadata.elementIds);
    },
  };
}
