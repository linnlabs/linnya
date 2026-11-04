import { expect, it } from 'vitest';
import { CanvasCardSchema, canvasRectanglesOverlap } from '../../../../shared';
import { createCanvasVisibleRegionProjection, subtractCanvasRegion, subtractCanvasRegions } from '../canvasVisibleRegions';
const source = { kind: 'user', conversationId: null, runId: null };
const card = (id: string, x: number, y: number, width: number, height: number) => CanvasCardSchema.parse({ id, type: 'text', schemaVersion: 1, revision: 1, order: 'a0',
  locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x, y, width, height, parentId: null,
  data: { contentVersion: 1, content: { type: 'doc', content: [] } } });
it('正文矩形差保留四条片段且不重复分配重叠像素', () => {
  const remainder = subtractCanvasRegion({ x: 0, y: 0, width: 100, height: 100 }, { x: 20, y: 30, width: 40, height: 50 });
  expect(remainder.reduce((sum, region) => sum + region.width * region.height, 0)).toBe(8000);
  for (let i = 0; i < remainder.length; i++) for (let j = i + 1; j < remainder.length; j++) expect(canvasRectanglesOverlap(remainder[i], remainder[j])).toBe(false);
});
it('只扣上层实体纸面，长卡和阴影圆角保留可见边缘', () => {
  const bottom = card('c1', 0, 0, 100, 50000), top = card('c2', 0, 0, 100, 100);
  const projection = createCanvasVisibleRegionProjection([bottom, top]);
  const regions = projection.get(bottom.id);
  expect(regions?.reduce((sum, region) => sum + region.width * region.height, 0)).toBe(5_000_000 - 88 * 88);
  expect(regions?.some(region => region.x === 0 && region.width === 100 && region.y >= 94)).toBe(true);
  expect(projection.get(top.id)).toEqual([{ x: 0, y: 0, width: 100, height: 100 }]);
});

it('多覆盖相减在负坐标、空交集、中心洞与交错遮挡上符合独立逐格oracle', () => {
  const regions = [{ x: -10, y: -8, width: 12, height: 18 }, { x: 4, y: 3, width: 18, height: 16 }];
  const contains = (rectangle: { x: number; y: number; width: number; height: number }, x: number, y: number) => x >= rectangle.x && x < rectangle.x + rectangle.width && y >= rectangle.y && y < rectangle.y + rectangle.height;
  let seed = 29;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let turn = 0; turn < 24; turn++) {
    const covers = Array.from({ length: 15 }, () => ({ x: next() % 40 - 14, y: next() % 40 - 14, width: next() % 12 + 1, height: next() % 12 + 1 }));
    const actual = subtractCanvasRegions(regions, covers);
    for (let y = -10; y < 22; y++) for (let x = -12; x < 25; x++) {
      const expected = regions.some(region => contains(region, x + 0.5, y + 0.5)) && !covers.some(cover => contains(cover, x + 0.5, y + 0.5));
      expect(actual.filter(region => contains(region, x + 0.5, y + 0.5)).length).toBe(expected ? 1 : 0);
    }
  }
});
