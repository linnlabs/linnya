import type { RenderNode } from '../../../types/render';
import type {
  ManualEditableTarget,
  ManualEditingVisualOperation,
  ManualEditingVisualPreview,
} from '../definitions/manualEditingTypes';
import {
  polygonBounds,
  rectToPolygon,
  type RenderNodeSelectionPoint,
} from '../../renderNodeSelection';

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
export function projectManualVisualPreviewsToRenderNode(
  node: RenderNode,
  previews: readonly ManualEditingVisualPreview[],
): RenderNode {
  return previews.reduce(projectManualVisualPreviewToRenderNode, node);
}

function projectManualVisualPreviewToRenderNode(
  node: RenderNode,
  preview: ManualEditingVisualPreview,
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
export function projectManualVisualPreviewsToSelectionPolygon(
  target: ManualEditableTarget,
  previews: readonly ManualEditingVisualPreview[],
): readonly RenderNodeSelectionPoint[] {
  return projectManualEditableTargetSelection(target, new Map(), previews).polygon;
}

/** 选框与内容绘制消费同一批位移／属性预览；Frame 取全部可见成员的当前几何并集。 */
export function projectManualEditableTargetSelection(
  target: ManualEditableTarget,
  translations: ReadonlyMap<string, { readonly dx: number; readonly dy: number }>,
  previews: readonly ManualEditingVisualPreview[],
): ManualEditableTarget {
  const fragments = target.frameSelectionFragments ?? [{
    elementId: target.elementId,
    polygon: target.polygon,
  }];
  const projectedFragments = fragments.flatMap((fragment) => {
    if (isElementHiddenByPreview(fragment.elementId, previews)) return [];
    const resized = projectVisualSizeToPolygon(fragment.elementId, fragment.polygon, previews);
    const translation = translations.get(fragment.elementId);
    return [{
      elementId: fragment.elementId,
      polygon: translation
        ? resized.map(point => ({
            x: point.x + translation.dx,
            y: point.y + translation.dy,
          }))
        : resized,
    }];
  });
  if (projectedFragments.length === 0) return target;
  const polygon = target.frameSelectionFragments
    ? rectToPolygon(polygonBounds(projectedFragments.flatMap(fragment => fragment.polygon)))
    : projectedFragments[0]?.polygon ?? target.polygon;
  return {
    ...target,
    bounds: polygonBounds(polygon),
    polygon,
  };
}

function projectVisualSizeToPolygon(
  elementId: string,
  polygon: readonly RenderNodeSelectionPoint[],
  previews: readonly ManualEditingVisualPreview[],
): readonly RenderNodeSelectionPoint[] {
  const preview = findLastVisualSizePreview(elementId, previews);
  if (
    !preview
    || preview.operation.op !== 'set_visual_size'
  ) {
    return polygon;
  }
  const origin = polygon[0];
  const horizontalEnd = polygon[1];
  const verticalEnd = polygon[3];
  if (!origin || !horizontalEnd || !verticalEnd) return polygon;
  const horizontalLength = Math.hypot(horizontalEnd.x - origin.x, horizontalEnd.y - origin.y);
  const verticalLength = Math.hypot(verticalEnd.x - origin.x, verticalEnd.y - origin.y);
  if (horizontalLength === 0 || verticalLength === 0) return polygon;
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

function findLastVisualSizePreview(
  elementId: string,
  previews: readonly ManualEditingVisualPreview[],
): ManualEditingVisualPreview | undefined {
  for (let index = previews.length - 1; index >= 0; index -= 1) {
    const preview = previews[index];
    if (
      preview?.elementId === elementId
      && preview.operation.op === 'set_visual_size'
    ) return preview;
  }
  return undefined;
}

function isElementHiddenByPreview(
  elementId: string,
  previews: readonly ManualEditingVisualPreview[],
): boolean {
  return previews.some(preview => (
    preview.operation.op === 'delete_target'
    && preview.affectedElementIds.includes(elementId)
  ));
}
