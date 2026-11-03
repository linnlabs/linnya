import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { addComposerReference, focusComposerInput } from '@plugin/renderer/composerCommandPort';
import { getWorkspaceNavigationPort } from '@plugin/renderer/workspaceNavigation';
import { CANVAS_PLUGIN_ID, CANVAS_DOCUMENT_TYPE, CanvasSelectionContextSchema } from '@plugin/canvas/shared';
import { saveCanvasDocumentDrafts } from '../features/canvasDocument';
import { focusCanvasReference, type CanvasSelectionReferencePort } from '../features/conversationSelection';
export function createCanvasSelectionReferencePort(): CanvasSelectionReferencePort {
  return { save: documentId => saveCanvasDocumentDrafts(documentId, false), add: addComposerReference, focusComposer: focusComposerInput,
    async read(input) { const response = await invokeRendererPluginIpc<unknown>(CANVAS_PLUGIN_ID, 'canvas:context', input); if (!response.success) throw new Error(response.error); return CanvasSelectionContextSchema.parse(response.data); },
    async activate(metadata) {
      await getWorkspaceNavigationPort().openDocumentTarget({ documentId: metadata.documentId, type: CANVAS_DOCUMENT_TYPE, projectId: metadata.projectId });
      await focusCanvasReference(metadata.documentId, metadata.elementIds);
    },
  };
}
