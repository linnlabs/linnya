import { CANVAS_PLUGIN_ID, type CanvasCardId } from '@plugin/canvas/shared';
import {
  CANVAS_SELECTION_REFERENCE_KIND,
  type CanvasSelectionReferencePort,
} from '../definitions/canvasSelectionReference';
import { buildCanvasSelectionReference } from '../functions/buildCanvasSelectionReference';
import { canvasText } from '../../localization';
export async function addCanvasSelectionReference(
  input: { documentId: string; projectId: string; elementIds: readonly CanvasCardId[] },
  port: CanvasSelectionReferencePort
): Promise<void> {
  if (!input.elementIds.length) throw new Error(canvasText('canvas.error.pickCards'));
  if (!(await port.save(input.documentId))) throw new Error(canvasText('canvas.error.finishInput'));
  const context = await port.read({ documentId: input.documentId, elementIds: input.elementIds });
  port.add({
    pluginId: CANVAS_PLUGIN_ID,
    kind: CANVAS_SELECTION_REFERENCE_KIND,
    ...buildCanvasSelectionReference(
      { ...input, elementIds: [...input.elementIds], originalCount: input.elementIds.length },
      context
    ),
  });
  if (!(await port.focusComposer())) throw new Error(canvasText('canvas.error.noComposer'));
}
