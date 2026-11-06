import { DocumentImageAssetSchema } from '@app/schemas';
import { queryDocumentReferences } from '@plugin/renderer/documentReferences';
import { getCurrentWorkspaceProjectId } from '@plugin/renderer/workspaceRuntime';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { CANVAS_PLUGIN_ID } from '@plugin/canvas/shared';
import type { CanvasCardCreationPort } from '../features/cardCreation';
async function request(channel: string, payload: unknown): Promise<unknown> {
  const result = await invokeRendererPluginIpc<unknown>(CANVAS_PLUGIN_ID, channel, payload);
  if (!result.success) throw new Error(result.error);
  return result.data;
}
export function createCanvasCardCreationPort(): CanvasCardCreationPort {
  return {
    prepareImage: async (documentId, bytesBase64) =>
      DocumentImageAssetSchema.parse(
        await request('canvas:prepare-image', { documentId, bytesBase64 })
      ),
    queryDocuments: keyword => {
      const projectId = getCurrentWorkspaceProjectId();
      if (!projectId) throw new Error('没有当前项目');
      return queryDocumentReferences({ projectId, keyword, limit: 50 });
    },
  };
}
