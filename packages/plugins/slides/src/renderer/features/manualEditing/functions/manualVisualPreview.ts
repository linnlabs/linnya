import type { RenderNode } from '../../../types/render';
import type {
  ManualEditableTarget,
  ManualEditingVisualOperation,
  ManualEditingVisualPreview,
} from '../definitions/manualEditingTypes';
import type { RenderNodeSelectionPoint } from '../../renderNodeSelection';

export function createManualVisualPreview(
  target: ManualEditableTarget,
  operation: ManualEditingVisualOperation,
): ManualEditingVisualPreview | null {
  if (
    operation.target.slideKey !== target.authoringRef.slideKey
    || operation.target.editKey !== target.authoringRef.editKey
  ) {
    return null;
  }
  return {
    elementId: target.elementId,
    affectedElementIds: operation.op === 'delete_target'
      ? target.translationElementIds
      : [target.elementId],
    operation,
  };
}

/**
 * 编译期间只投影用户刚提交的视觉值，正式 RenderModel 到达后整体撤下。
 * 文本换行仍以编译器结果为准；这里提供即时字号/颜色反馈，不复制排版算法。
 */
export function projectManualVisualPreviewToRenderNode(
  node: RenderNode,
  preview: ManualEditingVisualPreview | null | undefined,
): RenderNode {
  if (!preview) return node;
  if (preview.operation.op === 'delete_target') {
    return preview.affectedElementIds.includes(node.id) ? { ...node, visible: false } : node;
  }
  if (node.id !== preview.elementId) return node;
  if (preview.operation.op === 'set_visual_size') {
    if (node.kind !== 'shape' && node.kind !== 'image') return node;
    return {
      ...node,
      box: {
        ...node.box,
        w: preview.operation.visualSize.width,
        h: preview.operation.visualSize.height,
      },
    };
  }
  if (preview.operation.op === 'set_fill_color') {
    if (node.kind !== 'shape') return node;
    return {
      ...node,
      fill: { type: 'solid', color: preview.operation.color },
    };
  }
  if (preview.operation.op !== 'set_text_style' || node.kind !== 'text') return node;
  const textStyleOperation = preview.operation;
  return {
    ...node,
    paragraphs: node.paragraphs.map(paragraph => ({
      ...paragraph,
      runs: paragraph.runs.map(run => (
        'text' in run
          ? {
              ...run,
              ...(textStyleOperation.fontSizePt !== undefined
                ? { fontSize: textStyleOperation.fontSizePt }
                : {}),
              ...(textStyleOperation.color !== undefined
                ? { color: textStyleOperation.color }
                : {}),
            }
          : run
      )),
    })),
  };
}

/** 尺寸预览沿当前局部坐标轴缩放选框，旋转元素不会在提交瞬间跳回轴对齐。 */
export function projectManualVisualPreviewToSelectionPolygon(
  target: ManualEditableTarget,
  preview: ManualEditingVisualPreview | null | undefined,
): readonly RenderNodeSelectionPoint[] {
  if (
    !preview
    || preview.elementId !== target.elementId
    || preview.operation.op !== 'set_visual_size'
  ) {
    return target.polygon;
  }
  const origin = target.polygon[0];
  const horizontalEnd = target.polygon[1];
  const verticalEnd = target.polygon[3];
  if (!origin || !horizontalEnd || !verticalEnd) return target.polygon;
  const horizontalLength = Math.hypot(horizontalEnd.x - origin.x, horizontalEnd.y - origin.y);
  const verticalLength = Math.hypot(verticalEnd.x - origin.x, verticalEnd.y - origin.y);
  if (horizontalLength === 0 || verticalLength === 0) return target.polygon;
  const horizontal = {
    x: (horizontalEnd.x - origin.x) / horizontalLength * preview.operation.visualSize.width,
    y: (horizontalEnd.y - origin.y) / horizontalLength * preview.operation.visualSize.width,
  };
  const vertical = {
    x: (verticalEnd.x - origin.x) / verticalLength * preview.operation.visualSize.height,
    y: (verticalEnd.y - origin.y) / verticalLength * preview.operation.visualSize.height,
  };
  return [
    origin,
    { x: origin.x + horizontal.x, y: origin.y + horizontal.y },
    { x: origin.x + horizontal.x + vertical.x, y: origin.y + horizontal.y + vertical.y },
    { x: origin.x + vertical.x, y: origin.y + vertical.y },
  ];
}
