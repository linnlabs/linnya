import { getCurrentWorkspaceProjectId } from '@plugin/renderer/workspaceRuntime';
import {
  CanvasClipboardRequestSchema,
  CanvasClipboardSchema,
  CanvasSelectionContextRequestSchema,
  CanvasSelectionContextSchema,
  type CanvasElementId,
  type CanvasSelectionContextRequest,
} from '@plugin/canvas/shared';
import { requestCanvasIpc } from './requestCanvasIpc';
export async function readCanvasSelectionContext(
  input: Omit<CanvasSelectionContextRequest, 'elementIds' | 'format'> & {
    readonly elementIds: readonly string[];
    readonly format?: CanvasSelectionContextRequest['format'];
  }
) {
  return CanvasSelectionContextSchema.parse(
    await requestCanvasIpc('canvas:context', CanvasSelectionContextRequestSchema.parse(input))
  );
}
export async function readCanvasClipboard(
  documentId: string,
  elementIds: readonly CanvasElementId[]
) {
  return CanvasClipboardSchema.parse(
    await requestCanvasIpc(
      'canvas:clipboard',
      CanvasClipboardRequestSchema.parse({
        documentId,
        elementIds,
        projectId: getCurrentWorkspaceProjectId(),
      })
    )
  );
}
