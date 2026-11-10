import { describe, expect, it } from 'vitest';
import { canvasLineLabelAnchor } from '../canvasLineLabelAnchor';

const card = { x: 40, y: -20, width: 20, height: 40 };

describe('连线标签锚点', () => {
  it('中点没被卡片挡住时保持几何中点', () => {
    const midpoint = { x: 50, y: 0 };
    expect(
      canvasLineLabelAnchor(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        midpoint,
        []
      )
    ).toBe(midpoint);
  });
  it('中点落进卡片时挪到露在外面最长一段的中点', () => {
    // 0..40 露出，40..60 被挡，60..120 露出：最长一段是 60..120，标签在 90。
    const anchor = canvasLineLabelAnchor(
      [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
      ],
      { x: 50, y: 0 },
      [card]
    );
    expect(anchor).toEqual({ x: 90, y: 0 });
  });
  it('折线跨段相接的露出部分算作同一段', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
      { x: 100, y: 30 },
    ];
    const covering = [{ x: 60, y: 20, width: 50, height: 20 }];
    // 露出：0..30 横段 + 30 竖段 + 30..60 横段，共 90；被挡 60..100。中点在累计 45 处。
    expect(canvasLineLabelAnchor(points, { x: 70, y: 30 }, covering)).toEqual({ x: 30, y: 15 });
  });
  it('整条线都在卡片里时不画标签', () => {
    const anchor = canvasLineLabelAnchor(
      [
        { x: 45, y: 0 },
        { x: 55, y: 0 },
      ],
      { x: 50, y: 0 },
      [card]
    );
    expect(anchor).toBeNull();
  });
});
