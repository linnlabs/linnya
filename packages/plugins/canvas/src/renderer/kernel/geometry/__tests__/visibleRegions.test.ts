import { expect, it } from 'vitest';
import { CanvasCardSchema, canvasRectanglesOverlap } from '../../../../shared';
import { createCanvasVisibleRegionProjection, subtractCanvasRegion } from '../canvasVisibleRegions';
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
