import { DocumentImageAssetSchema, DocumentPreviewResultSchema } from '@app/schemas';
import { readDocumentPreview, readDocumentPreviewTypeIcon } from '@plugin/renderer/documentPreview';
import {
  getCurrentWorkspaceProjectId,
  subscribeWorkspaceMutations,
} from '@plugin/renderer/workspaceRuntime';
import { readDocumentReference } from '@plugin/renderer/documentReferences';
import { subscribeRendererPluginAvailability } from '@plugin/renderer/pluginRuntime';
import { getWorkspaceNavigationPort } from '@plugin/renderer/workspaceNavigation';
import type { CanvasCardMediaPort } from '../features/cardMedia';
import { canvasText } from '../features/localization';
import { requestCanvasIpc } from './requestCanvasIpc';
export function createCanvasCardMediaPort(
  projectId = getCurrentWorkspaceProjectId()
): CanvasCardMediaPort {
  return {
    async readImage(documentId, assetId) {
      return DocumentImageAssetSchema.parse(
        await requestCanvasIpc('canvas:read-image', { documentId, assetId })
      );
    },
    preview: async input => DocumentPreviewResultSchema.parse(await readDocumentPreview(input)),
    reference: documentId => {
      if (!projectId) throw new Error(canvasText('canvas.error.projectMissingForIdentity'));
      return readDocumentReference({ projectId, documentId });
    },
    subscribe: subscribeWorkspaceMutations,
    subscribeAvailability: listener =>
      subscribeRendererPluginAvailability(changes =>
        listener(changes.flatMap(change => change.documentNodeTypes))
      ),
    projectId: () => projectId,
    typeIcon: readDocumentPreviewTypeIcon,
    openDocument: (documentId, nodeType, displayName) =>
      getWorkspaceNavigationPort().openDocumentByNodeType({
        documentId,
        nodeType,
        displayName,
        projectId,
      }),
  };
}
