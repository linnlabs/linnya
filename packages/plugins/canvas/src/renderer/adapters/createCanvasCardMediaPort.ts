import { DocumentImageAssetSchema, DocumentPreviewResultSchema } from '@app/schemas';
import { readDocumentPreview } from '@plugin/renderer/documentPreview';
import { getCurrentWorkspaceProjectId } from '@plugin/renderer/workspaceRuntime';
import { getWorkspaceNavigationPort } from '@plugin/renderer/workspaceNavigation';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { CANVAS_PLUGIN_ID } from '@plugin/canvas/shared';
import type { CanvasCardMediaPort } from '../features/cardMedia';
export function createCanvasCardMediaPort(): CanvasCardMediaPort {
  return {
    async readImage(documentId, assetId) {
      const result = await invokeRendererPluginIpc<unknown>(CANVAS_PLUGIN_ID, 'canvas:read-image', { documentId, assetId });
      if (!result.success) throw new Error(result.error);
      return DocumentImageAssetSchema.parse(result.data);
    },
    preview: async input => DocumentPreviewResultSchema.parse(await readDocumentPreview(input)),
    projectId: getCurrentWorkspaceProjectId,
    openDocument: (documentId, type, displayName) => getWorkspaceNavigationPort().openDocument({ documentId, type, displayName, projectId: getCurrentWorkspaceProjectId() }),
  };
}
