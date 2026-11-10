import type { CanvasCard } from '../../../../shared';
import type { CanvasLayoutPosition } from '../definitions/canvasLayoutPlan';

export function layoutCanvasGrid(
  cards: readonly CanvasCard[],
  columns = Math.ceil(Math.sqrt(cards.length))
): readonly CanvasLayoutPosition[] {
  if (!cards.length) return [];
  const count = Math.min(columns, cards.length);
  const widths = Array<number>(count).fill(0),
    heights = Array<number>(Math.ceil(cards.length / count)).fill(0);
  cards.forEach((card, index) => {
    widths[index % count] = Math.max(widths[index % count], card.width);
    heights[Math.floor(index / count)] = Math.max(heights[Math.floor(index / count)], card.height);
  });
  const offsets = (sizes: readonly number[]) => {
    let value = 0;
    return sizes.map(size => {
      const offset = value;
      value += size + 40;
      return offset;
    });
  };
  const x = offsets(widths),
    y = offsets(heights);
  return cards.map((card, index) => ({
    id: card.id,
    x: x[index % count],
    y: y[Math.floor(index / count)],
  }));
}
