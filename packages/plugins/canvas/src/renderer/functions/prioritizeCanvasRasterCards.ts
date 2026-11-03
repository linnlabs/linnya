import type { CanvasCard, CanvasCardId, CanvasPoint, CanvasRectangle } from '../../shared';

/** 指针距真实可见正文框越近越先补；同距才按可见面积，遮挡纸面不抢占优先级。 */
export function prioritizeCanvasRasterCards(cards: readonly CanvasCard[], readRegions: (id: CanvasCardId) => readonly CanvasRectangle[], point: CanvasPoint | null): Map<CanvasCardId, number> {
  const ranked = cards.map(card => {
    let area = 0, distance = point ? Infinity : 0;
    for (const region of readRegions(card.id)) {
      area += region.width * region.height;
      if (point) {
        const x = point.x - card.x, y = point.y - card.y;
        const dx = Math.max(region.x - x, 0, x - region.x - region.width), dy = Math.max(region.y - y, 0, y - region.y - region.height);
        distance = Math.min(distance, dx * dx + dy * dy);
      }
    }
    return { card, area, distance };
  }).sort((a, b) => a.distance - b.distance || b.area - a.area);
  return new Map(ranked.map((item, index): [CanvasCardId, number] => [item.card.id, index]));
}
