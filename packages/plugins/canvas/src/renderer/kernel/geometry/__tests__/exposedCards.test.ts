import { expect, it } from 'vitest';
import { CanvasCardSchema } from '../../../../shared';
import { selectExposedCanvasCards } from '../selectExposedCanvasCards';
const source = { kind: 'user', conversationId: null, runId: null };
const card = (id: string, x: number, y: number, width: number, height: number) => CanvasCardSchema.parse({ id, type: 'text', schemaVersion: 1, revision: 1,
  order: 'a0', locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x, y, width, height,
  parentId: null, data: { contentVersion: 1, content: { type: 'doc', content: [] } } });
it('只剔除被实体纸面全覆盖的卡，露出边缘和视口裁切仍保留', () => {
  const hidden = card('c1', 64, 64, 32, 32), partial = card('c2', 0, 0, 100, 100), top = card('c3', 32, 32, 128, 128);
  expect(selectExposedCanvasCards([hidden, partial, top], { x: 0, y: 0, zoom: 1 }, 200, 200).map(item => item.id)).toEqual(['c2', 'c3']);
  expect(selectExposedCanvasCards([partial], { x: -50, y: -50, zoom: 1 }, 100, 100).map(item => item.id)).toEqual(['c2']);
});
