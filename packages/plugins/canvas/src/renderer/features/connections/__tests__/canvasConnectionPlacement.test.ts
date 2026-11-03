import { expect, it } from 'vitest';
import { CanvasTextCardSchema, createCanvasPlainTextDocument } from '@plugin/canvas/shared';
import { canvasEndpointAt } from '../functions/canvasConnectionAnchors';
import { canvasConnectionToolbarPosition } from '../functions/canvasConnectionToolbarPosition';

const card = CanvasTextCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, x: 100, y: 100, width: 200, height: 100, parentId: null, data: { contentVersion: 1, content: createCanvasPlainTextDocument('卡片') } });
it('落在卡身用自动端点，仅16屏幕像素圆点固定边，圆点外半圈也可命中', () => {
  expect(canvasEndpointAt({ x: 150, y: 150 }, [card], 1)).toEqual({ kind: 'card', cardId: card.id, side: 'auto' });
  expect(canvasEndpointAt({ x: 305, y: 150 }, [card], 1)).toEqual({ kind: 'card', cardId: card.id, side: 'right' });
  expect(canvasEndpointAt({ x: 310, y: 150 }, [card], 1)).toEqual({ kind: 'point', x: 310, y: 150 });
  expect(canvasEndpointAt({ x: 310, y: 150 }, [card], 0.5)).toEqual({ kind: 'card', cardId: card.id, side: 'right' });
});
it('线浮条避开上方卡片、连线与标签后选择下方位置', () => {
  const point = canvasConnectionToolbarPosition({ midpoint: { x: 400, y: 300 }, size: { width: 200, height: 40 }, viewport: { width: 1000, height: 800 },
    cards: [{ x: 280, y: 150, width: 240, height: 145 }], line: [{ x: 50, y: 300 }, { x: 750, y: 300 }], label: { x: 300, y: 288, width: 200, height: 24 } });
  expect(point).toEqual({ x: 300, y: 314 });
});
