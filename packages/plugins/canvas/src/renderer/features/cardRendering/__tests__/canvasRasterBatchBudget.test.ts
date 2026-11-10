import { expect, it } from 'vitest';
import { CanvasCardSchema } from '../../../../shared';
import { chooseCanvasRasterBatchSize } from '../functions/chooseCanvasRasterBatchSize';
import type { CanvasCardRasterInput } from '../definitions/canvasCardRasterization';

function item(index: number, large = false, complex = false): CanvasCardRasterInput {
  const card = CanvasCardSchema.parse({ id: `c${index + 1}`, type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white',
    x: 0, y: 0, width: large ? 600 : 88, height: large ? 800 : 72, parentId: null,
    createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0,
    data: { contentVersion: 1, content: { type: 'doc', content: [{ type: complex ? 'heading' : 'paragraph', content: [{ type: 'text', text: '中文小卡' }] }] } } });
  return { card, dark: false, scale: large ? 2 : 70 / 88, regions: [{ x: 0, y: 0, width: card.width, height: card.height }] };
}
it('小卡在原64任务容量内合批，移动时减半；不把复杂正文或大量像素塞进新增批次', () => {
  const small = Array.from({ length: 64 }, (_, i) => item(i));
  expect(chooseCanvasRasterBatchSize(small, false)).toBe(64); expect(chooseCanvasRasterBatchSize(small, true)).toBe(32);
  expect(chooseCanvasRasterBatchSize(Array.from({ length: 64 }, (_, i) => item(i, true)), false)).toBe(32);
  expect(chooseCanvasRasterBatchSize(Array.from({ length: 64 }, (_, i) => item(i, false, true)), true)).toBe(16);
  const mixed = [...small.slice(0, 40), item(40, false, true), ...small.slice(41)];
  expect(chooseCanvasRasterBatchSize(mixed, false)).toBe(40);
  expect(small[0].scale).toBe(70 / 88); expect(small[0].regions).toEqual([{ x: 0, y: 0, width: 88, height: 72 }]);
});
