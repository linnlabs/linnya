import { canvasBounds, type CanvasSnapshot, type CanvasCard } from '../../../../shared';
import { canvasRenderRectangles } from '../../../../shared/rendering/functions/canvasRenderRectangles';

const regions = ['左上', '上方', '右上', '左侧', '正中', '右侧', '左下', '下方', '右下'];
/** 模型选择语义区域或卡片身份，实际裁剪坐标从当前快照计算。 */
export function readCanvasRenderRegion(
  snapshot: CanvasSnapshot,
  scope: { readonly elementIds?: readonly string[]; readonly region?: string }
) {
  if (scope.elementIds && scope.region) throw new Error('render_scope_conflict');
  if (scope.elementIds) {
    const wanted = new Set(scope.elementIds);
    const cards = snapshot.elements.filter(
      (element): element is CanvasCard => element.type !== 'edge' && wanted.has(element.id)
    );
    if (new Set(cards.map(card => card.id)).size !== new Set(scope.elementIds).size)
      throw new Error('canvas_element_not_found');
    return canvasBounds(cards);
  }
  if (!scope.region) return null;
  const index = regions.indexOf(scope.region);
  if (index < 0) throw new Error('render_region_invalid');
  const bounds = canvasBounds(canvasRenderRectangles(snapshot.elements));
  if (!bounds) return null;
  return {
    x: bounds.x + ((index % 3) * bounds.width) / 3,
    y: bounds.y + (Math.floor(index / 3) * bounds.height) / 3,
    width: bounds.width / 3,
    height: bounds.height / 3,
  };
}
