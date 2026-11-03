import { DocumentImageAssetSchema, DocumentPreviewResultSchema } from '@app/schemas';
import { readDocumentPreview } from '@plugin/renderer/documentPreview';
import { getCurrentWorkspaceProjectId, subscribeWorkspaceMutations } from '@plugin/renderer/workspaceRuntime';
import { readDocumentReference } from '@plugin/renderer/documentReferences';
import { subscribeRendererPluginAvailability } from '@plugin/renderer/pluginRuntime';
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
    reference: documentId => { const projectId = getCurrentWorkspaceProjectId(); if (!projectId) throw new Error('没有当前项目，无法读取文档身份'); return readDocumentReference({ projectId, documentId }); },
    subscribe: subscribeWorkspaceMutations,
    subscribeAvailability: listener => subscribeRendererPluginAvailability(changes => listener(changes.flatMap(change => change.documentNodeTypes))),
    projectId: getCurrentWorkspaceProjectId,
    openDocument: (documentId, type, displayName) => getWorkspaceNavigationPort().openDocument({ documentId, type, displayName, projectId: getCurrentWorkspaceProjectId() }),
  };
}
