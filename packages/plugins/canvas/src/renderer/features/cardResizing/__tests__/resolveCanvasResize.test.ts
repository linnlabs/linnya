import { describe, expect, it } from 'vitest';
import { CanvasTextCardSchema, createCanvasPlainTextDocument } from '@plugin/canvas/shared';
import { resolveCanvasResize } from '../functions/resolveCanvasResize';
import type { CanvasResizeEdge } from '../definitions/cardResizing';

const card = CanvasTextCardSchema.parse({
  id: 'c1',
  type: 'text',
  schemaVersion: 1,
  revision: 1,
  order: 'a0',
  locked: false,
  color: 'white',
  createdBy: { kind: 'user', conversationId: null, runId: null },
  updatedBy: { kind: 'user', conversationId: null, runId: null },
  createdAt: 0,
  updatedAt: 0,
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  parentId: null,
  data: { contentVersion: 1, content: createCanvasPlainTextDocument('卡片') },
});
const drag = (edge: CanvasResizeEdge, dx: number, dy: number, shiftKey = false, zoom = 1) =>
  resolveCanvasResize(
    { card, edge, clientX: 0, clientY: 0, zoom },
    { clientX: dx, clientY: dy, shiftKey }
  );

describe('从任意边或角改尺寸', () => {
  it('被拖的边跟随指针，对边不动；单边只改一个方向', () => {
    expect(drag('e', 40, 30)).toEqual({ x: 100, y: 100, width: 240, height: 100 });
    expect(drag('s', 40, 30)).toEqual({ x: 100, y: 100, width: 200, height: 130 });
    expect(drag('w', -40, 30)).toEqual({ x: 60, y: 100, width: 240, height: 100 });
    expect(drag('n', 40, -30)).toEqual({ x: 100, y: 70, width: 200, height: 130 });
    expect(drag('nw', 20, 10)).toEqual({ x: 120, y: 110, width: 180, height: 90 });
    expect(drag('se', 20, 10, false, 2)).toEqual({ x: 100, y: 100, width: 210, height: 105 });
  });
  it('缩到下限时右边与下边仍固定在原处', () => {
    expect(drag('w', 500, 0)).toEqual({ x: 220, y: 100, width: 80, height: 100 });
    expect(drag('n', 0, 500)).toEqual({ x: 100, y: 140, width: 200, height: 60 });
  });
  it('Shift 保持比例：拖边时另一方向跟着缩放，拖角取变化较大的一边', () => {
    expect(drag('e', 100, 0, true)).toEqual({ x: 100, y: 100, width: 300, height: 150 });
    expect(drag('n', 0, -50, true)).toEqual({ x: 100, y: 50, width: 300, height: 150 });
    expect(drag('sw', -100, 0, true)).toEqual({ x: 0, y: 100, width: 300, height: 150 });
  });
});
