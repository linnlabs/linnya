import { getCurrentWorkspaceProjectId } from '@plugin/renderer/workspaceRuntime';
import { CanvasClipboardRequestSchema, CanvasClipboardSchema, CanvasSelectionContextRequestSchema, CanvasSelectionContextSchema, CANVAS_PLUGIN_ID, type CanvasElementId, type CanvasSelectionContextRequest } from '@plugin/canvas/shared';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
export async function readCanvasSelectionContext(input: Omit<CanvasSelectionContextRequest, 'elementIds' | 'format'> & { readonly elementIds: readonly string[]; readonly format?: CanvasSelectionContextRequest['format'] }) {
  const response = await invokeRendererPluginIpc<unknown>(CANVAS_PLUGIN_ID, 'canvas:context', CanvasSelectionContextRequestSchema.parse(input));
  if (!response.success) throw new Error(response.error); return CanvasSelectionContextSchema.parse(response.data);
}
export async function readCanvasClipboard(documentId: string, elementIds: readonly CanvasElementId[]) {
  const response = await invokeRendererPluginIpc<unknown>(CANVAS_PLUGIN_ID, 'canvas:clipboard', CanvasClipboardRequestSchema.parse({ documentId, elementIds, projectId: getCurrentWorkspaceProjectId() }));
  if (!response.success) throw new Error(response.error);
  return CanvasClipboardSchema.parse(response.data);
}
