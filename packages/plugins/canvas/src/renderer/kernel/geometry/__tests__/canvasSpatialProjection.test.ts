import { expect, it } from 'vitest';
import { CanvasCardSchema, type CanvasCard, type CanvasRectangle } from '../../../../shared';
import { CanvasSpatialProjection } from '../CanvasSpatialProjection';
import { createCanvasVisibleRegionProjection, intersectCanvasRegion, subtractCanvasRegions } from '../canvasVisibleRegions';

const source = { kind: 'user', conversationId: null, runId: null };
const card = (id: string, bounds: CanvasRectangle) => CanvasCardSchema.parse({ id, type: 'text', schemaVersion: 1, revision: 1, order: 'a0',
  locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, ...bounds, parentId: null,
  data: { contentVersion: 1, content: { type: 'doc', content: [] } } });
const area = (regions: readonly CanvasRectangle[], viewport: CanvasRectangle) => regions.reduce((sum, region) => {
  const part = intersectCanvasRegion(region, viewport); return sum + (part ? part.width * part.height : 0);
}, 0);
function expectSameVisibleRegions(actual: readonly CanvasRectangle[], expected: readonly CanvasRectangle[], viewport: CanvasRectangle) {
  const clip = (regions: readonly CanvasRectangle[]) => regions.flatMap(region => { const visible = intersectCanvasRegion(region, viewport); return visible ? [visible] : []; });
  const a = clip(actual), b = clip(expected);
  expect(area(a, viewport)).toBeCloseTo(area(b, viewport), 5);
  expect(area(subtractCanvasRegions(a, b), viewport) + area(subtractCanvasRegions(b, a), viewport)).toBeCloseTo(0, 5);
}
it('索引投影与逐卡矩形差在负坐标、跨格、长卡和重叠纸面上保持相同可见面积', () => {
  const cards: CanvasCard[] = [card('c1', { x: -200, y: -300, width: 280, height: 50000 })];
  let seed = 117;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 250; i++) cards.push(card(`c${i + 2}`, { x: -300 + random() * 1600, y: -400 + random() * 1200, width: 80 + random() * 300, height: 40 + random() * 200 }));
  const index = new CanvasSpatialProjection(); index.setCards(cards);
  const viewport = { x: -250, y: -300, width: 1500, height: 1000 }, actual = index.project(viewport), expected = createCanvasVisibleRegionProjection(cards);
  for (const entry of cards) expectSameVisibleRegions(actual.get(entry.id) ?? [], expected.get(entry.id) ?? [], viewport);
  const builds = index.readStats().spatialCellBuilds;
  expect(index.project({ ...viewport, x: viewport.x + 1 })).toBe(actual);
  expect(index.readStats().spatialCellBuilds).toBe(builds);
});
it('拖动顶层纸面立即显露下层正文，取消后恢复；不重建无关世界格', () => {
  const bottom = card('c1', { x: 20, y: 20, width: 100, height: 100 }), top = card('c2', { x: 0, y: 0, width: 140, height: 140 });
  const remote = card('c3', { x: 2000, y: 2000, width: 100, height: 100 }), index = new CanvasSpatialProjection();
  index.setCards([bottom, top, remote]);
  const viewport = { x: -10, y: -10, width: 2500, height: 2500 };
  expect(area(index.project(viewport).get(bottom.id) ?? [], viewport)).toBe(0);
  const originalBuilds = index.readStats().spatialCellBuilds;
  const display = { ...top, x: 180 }; index.updateCards([display]);
  expect(area(index.project(viewport).get(bottom.id) ?? [], viewport)).toBe(10000);
  expect(index.readStats().spatialCellBuilds - originalBuilds).toBe(1);
  // display对象下一次pointer原地变化，仍应和索引自己的bounds快照比较。
  display.x = 0; index.updateCards([display]);
  expect(area(index.project(viewport).get(bottom.id) ?? [], viewport)).toBe(0);
  index.updateCards([top]); expect(index.hitTest({ x: 30, y: 30 })?.id).toBe(top.id);
});
it('命中只查询点所在世界格和长卡，删除/移入/层级变化使用当前display事实', () => {
  const cards = Array.from({ length: 12000 }, (_, i) => card(`c${i + 1}`, { x: i * 1024, y: 0, width: 280, height: 180 }));
  const index = new CanvasSpatialProjection(); index.setCards(cards);
  expect(index.hitTest({ x: 10, y: 10 })?.id).toBe('c1'); expect(index.readStats().spatialHitCandidates).toBe(1);
  const moved = { ...cards[11999], x: 0 }; index.updateCards([moved]);
  expect(index.hitTest({ x: 10, y: 10 })?.id).toBe(moved.id); expect(index.readStats().spatialHitCandidates).toBe(2);
  index.setCards([moved, cards[0]]); expect(index.hitTest({ x: 10, y: 10 })?.id).toBe('c1');
  index.setCards([cards[0]]); expect(index.hitTest({ x: 10, y: 10 })?.id).toBe('c1');
  const boundary = card('c2', { x: -512, y: -512, width: 512, height: 512 }); index.setCards([boundary]);
  expect(index.hitTest({ x: 0, y: 0 })?.id).toBe('c2');
});
it('密集多卡交错移动与层级重装不会复用失效遮挡证明', () => {
  let cards = Array.from({ length: 160 }, (_, i) => card(`c${i + 1}`, { x: (i * 37) % 600 - 100, y: (i * 71) % 500 - 100, width: 280, height: 180 }));
  const index = new CanvasSpatialProjection(), viewport = { x: -150, y: -150, width: 1100, height: 900 };
  index.setCards(cards); index.project(viewport);
  for (let turn = 0; turn < 20; turn++) {
    const ids = new Set([turn % 160, (turn * 7 + 80) % 160, 159]);
    cards = cards.map((entry, position) => ids.has(position) ? { ...entry, x: entry.x + 11 * (turn % 3 - 1), y: entry.y + 9 * (turn % 2 ? 1 : -1) } : entry);
    index.updateCards(cards.filter((_, position) => ids.has(position)));
    const actual = index.project(viewport), expected = createCanvasVisibleRegionProjection(cards);
    for (const entry of cards) expectSameVisibleRegions(actual.get(entry.id) ?? [], expected.get(entry.id) ?? [], viewport);
  }
  cards = cards.slice().reverse(); index.setCards(cards);
  const actual = index.project(viewport), expected = createCanvasVisibleRegionProjection(cards);
  for (const entry of cards) expectSameVisibleRegions(actual.get(entry.id) ?? [], expected.get(entry.id) ?? [], viewport);
});
it('非重叠卡跨世界格仍只生成完整可见矩形，真实遮挡缺口保持原样', () => {
  const cards = Array.from({ length: 500 }, (_, i) => card(`c${i + 1}`, { x: i % 25 * 240 - 600, y: Math.floor(i / 25) * 180 - 400, width: 200, height: 140 }));
  const index = new CanvasSpatialProjection(), viewport = { x: -600, y: -400, width: 6000, height: 3600 };
  index.setCards(cards);
  const projection = index.project(viewport);
  for (const entry of cards) expect(projection.get(entry.id)).toEqual([{ x: entry.x, y: entry.y, width: entry.width, height: entry.height }]);
  const cover = card('c501', { x: -520, y: -380, width: 80, height: 90 }); index.setCards([...cards, cover]);
  const covered = index.project(viewport), expected = createCanvasVisibleRegionProjection([...cards, cover]);
  for (const entry of cards) expectSameVisibleRegions(covered.get(entry.id) ?? [], expected.get(entry.id) ?? [], viewport);
});
it('半透明新增卡不挖掉下层正文，变为实体后再按当前纸面遮挡', () => {
  const bottom = card('c1', { x: 20, y: 20, width: 100, height: 100 }), top = card('c2', { x: 0, y: 0, width: 140, height: 140 });
  const index = new CanvasSpatialProjection(), viewport = { x: 0, y: 0, width: 200, height: 200 };
  index.setCards([bottom, top]); expect(area(index.project(viewport).get(bottom.id) ?? [], viewport)).toBe(0);
  index.setTranslucent(new Set([top.id])); expect(area(index.project(viewport).get(bottom.id) ?? [], viewport)).toBe(10000);
  expect(index.hitTest({ x: 30, y: 30 }, entry => entry.id !== top.id)?.id).toBe(bottom.id);
  index.setTranslucent(new Set()); expect(area(index.project(viewport).get(bottom.id) ?? [], viewport)).toBe(0);
});
