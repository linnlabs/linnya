import { DocumentImageAssetSchema } from '@app/schemas';
import { queryDocumentReferences } from '@plugin/renderer/documentReferences';
import { getCurrentWorkspaceProjectId } from '@plugin/renderer/workspaceRuntime';
import type { CanvasCardCreationPort } from '../features/cardCreation';
import { canvasText } from '../features/localization';
import { requestCanvasIpc } from './requestCanvasIpc';
export function createCanvasCardCreationPort(): CanvasCardCreationPort {
  return {
    prepareImage: async (documentId, bytesBase64) =>
      DocumentImageAssetSchema.parse(
        await requestCanvasIpc('canvas:prepare-image', { documentId, bytesBase64 })
      ),
    queryDocuments: keyword => {
      const projectId = getCurrentWorkspaceProjectId();
      if (!projectId) throw new Error(canvasText('canvas.error.projectMissing'));
      return queryDocumentReferences({ projectId, keyword, limit: 50 });
    },
  };
}
