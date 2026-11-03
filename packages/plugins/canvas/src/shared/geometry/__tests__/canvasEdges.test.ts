import { expect, it } from 'vitest';
import { CanvasCardSchema, CanvasEdgeSchema } from '../../model/definitions/canvasElement';
import { layoutCanvasEdges, resolveCanvasEdgeGeometry } from '../functions/canvasEdgeGeometry';

const source = { kind: 'user', conversationId: null, runId: null };
const base = { schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0 };
const card = (id: string, x: number, y: number) => CanvasCardSchema.parse({ ...base, id, type: 'text', x, y, width: 200, height: 100, parentId: null,
  data: { contentVersion: 1, content: { type: 'doc', content: [] } } });
const a = card('c1', 0, 0), b = card('c2', 1000, 0), c = card('c3', 1000, 500);
const cards = new Map([a, b, c].map(item => [item.id, item]));
const edge = (id: string, to = b.id) => CanvasEdgeSchema.parse({ ...base, id, type: 'edge', from: { kind: 'card', cardId: a.id, side: 'auto' },
  to: { kind: 'card', cardId: to, side: 'auto' }, direction: 'forward', lineStyle: 'curve', label: '' });

it('长曲线端点留在卡边，控制柄收敛，直线按中心连线裁切', () => {
  const curved = resolveCanvasEdgeGeometry(edge('e1'), cards, 4);
  expect(curved.from).toEqual({ x: 200, y: 50 }); expect(curved.to).toEqual({ x: 1000, y: 50 });
  expect(curved.points.length).toBeLessThanOrEqual(129);
  expect(curved.points.every(point => point.x >= 200 && point.x <= 1000 && point.y === 50)).toBe(true);
  const straight = resolveCanvasEdgeGeometry({ ...edge('e2', c.id), lineStyle: 'straight' }, cards);
  expect(straight.from).toEqual({ x: 200, y: 100 }); expect(straight.to).toEqual({ x: 1000, y: 500 });
});
it('同侧端点按另一端顺序排开，悬空端点保留自己的世界坐标', () => {
  const first = edge('e1'), second = edge('e2', c.id);
  const layouts = layoutCanvasEdges([first, second], cards, 1);
  expect(layouts.get(first.id)?.from).toEqual({ x: 200, y: 42 });
  expect(layouts.get(second.id)?.from).toEqual({ x: 200, y: 58 });
  const dangling = resolveCanvasEdgeGeometry({ ...first, to: { kind: 'point', x: 500, y: -100 } }, cards);
  expect(dangling.to).toEqual({ x: 500, y: -100 });
});
it('拖动跨过对角线时保留24世界单位迟滞，不来回换边', () => {
  const target = card('c2', 190, 160), moved = card('c2', 200, 150), connection = edge('e1');
  const before = layoutCanvasEdges([connection], new Map([[a.id, a], [target.id, target]]), 1);
  expect(before.get(connection.id)?.fromSide).toBe('bottom');
  const after = layoutCanvasEdges([connection], new Map([[a.id, a], [moved.id, moved]]), 1, before);
  expect(after.get(connection.id)?.fromSide).toBe('bottom');
});
