import { canvasBounds, type CanvasCard } from '../../../../shared';

export const canvasProjectionRegions = [
  '左上',
  '上方',
  '右上',
  '左侧',
  '正中',
  '右侧',
  '左下',
  '下方',
  '右下',
];

/** 方位仅表达阅读范围；投影不向Agent输出坐标。 */
export function groupCanvasProjectionRegions(
  cards: readonly CanvasCard[]
): ReadonlyMap<string, CanvasCard[]> {
  const bounds = canvasBounds(cards);
  const groups = new Map<string, CanvasCard[]>();
  for (const card of cards) {
    const column =
      bounds && bounds.width > 0
        ? Math.min(
            2,
            Math.max(0, Math.floor(((card.x + card.width / 2 - bounds.x) / bounds.width) * 3))
          )
        : 1;
    const row =
      bounds && bounds.height > 0
        ? Math.min(
            2,
            Math.max(0, Math.floor(((card.y + card.height / 2 - bounds.y) / bounds.height) * 3))
          )
        : 1;
    const region = canvasProjectionRegions[row * 3 + column] ?? '正中';
    const group = groups.get(region) ?? [];
    group.push(card);
    groups.set(region, group);
  }
  return groups;
}
