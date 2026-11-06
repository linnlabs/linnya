import { CANVAS_PLUGIN_ID, type CanvasCardId } from '@plugin/canvas/shared';
import {
  CANVAS_SELECTION_REFERENCE_KIND,
  type CanvasSelectionReferencePort,
} from '../definitions/canvasSelectionReference';
import { buildCanvasSelectionReference } from '../functions/buildCanvasSelectionReference';
export async function addCanvasSelectionReference(
  input: { documentId: string; projectId: string; elementIds: readonly CanvasCardId[] },
  port: CanvasSelectionReferencePort
): Promise<void> {
  if (!input.elementIds.length) throw new Error('请先选择卡片');
  if (!(await port.save(input.documentId))) throw new Error('请先完成当前正文输入');
  const context = await port.read({ documentId: input.documentId, elementIds: input.elementIds });
  port.add({
    pluginId: CANVAS_PLUGIN_ID,
    kind: CANVAS_SELECTION_REFERENCE_KIND,
    ...buildCanvasSelectionReference(
      { ...input, elementIds: [...input.elementIds], originalCount: input.elementIds.length },
      context
    ),
  });
  if (!(await port.focusComposer())) throw new Error('当前没有可聚焦的对话输入框');
}
