import { expect, it } from 'vitest';
import {
  assignCanvasSections,
  CanvasSectionCardSchema,
  CanvasTextCardSchema,
  createCanvasPlainTextDocument,
  fitCanvasSection,
  orderCanvasCardsForReading,
  readCanvasCardConnections,
  type CanvasElement,
} from '../..';

const source = { kind: 'user', conversationId: null, runId: null } as const;
const identity = { schemaVersion: 1, revision: 1, order: 'a0', color: 'white', locked: false, createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0 } as const;
const card = (id: string, x: number, y: number, parentId: string | null = null) =>
  CanvasTextCardSchema.parse({ ...identity, type: 'text', id, x, y, width: 100, height: 60, parentId, data: { contentVersion: 1, content: createCanvasPlainTextDocument(id), heightMode: 'auto' } });
const section = (id: string, x: number, y: number, width = 400, height = 300) =>
  CanvasSectionCardSchema.parse({ ...identity, type: 'section', id, x, y, width, height, parentId: null, data: { title: id } });

it('分区只向外长：保留用户拉大的空位，成员越界时撑开到包住成员加内边距', () => {
  expect(fitCanvasSection({ x: 0, y: 0, width: 400, height: 300 }, [{ x: 30, y: 60, width: 100, height: 60 }])).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  expect(fitCanvasSection({ x: 0, y: 0, width: 200, height: 100 }, [{ x: 10, y: 20, width: 300, height: 60 }])).toEqual({ x: -14, y: -28, width: 348, height: 132 });
});

it('界面里放卡按落点进出分区；分区带着成员移动时成员不换区，显式归属不改', () => {
  const elements: CanvasElement[] = [section('c1', 0, 0), card('c2', 30, 60, 'c1'), card('c3', 800, 0), section('c4', 1000, 0)];
  const [moved, out, along] = assignCanvasSections(elements, [
    { op: 'update', id: 'c3', baseRevision: 1, patch: { x: 100, y: 100 } },
    { op: 'update', id: 'c2', baseRevision: 1, patch: { x: 600, y: 600 } },
    { op: 'update', id: 'c4', baseRevision: 1, patch: { x: 2000, y: 0 } },
  ]);
  expect(moved).toMatchObject({ patch: { parentId: 'c1' } });
  expect(out).toMatchObject({ patch: { parentId: null } });
  expect(along).toEqual({ op: 'update', id: 'c4', baseRevision: 1, patch: { x: 2000, y: 0 } });
  const [carried] = assignCanvasSections(elements, [
    { op: 'update', id: 'c1', baseRevision: 1, patch: { x: 500, y: 0 } },
    { op: 'update', id: 'c2', baseRevision: 1, patch: { x: 530, y: 60 } },
  ].reverse() as never);
  expect(carried).toEqual({ op: 'update', id: 'c2', baseRevision: 1, patch: { x: 530, y: 60 } });
  const [added, explicit, header] = assignCanvasSections(elements, [
    { op: 'addText', content: createCanvasPlainTextDocument('新'), x: 1100, y: 100, width: 100, height: 60 },
    { op: 'addText', content: createCanvasPlainTextDocument('新'), x: 1100, y: 100, width: 100, height: 60, parentId: '$other' },
    { op: 'addText', content: createCanvasPlainTextDocument('标题条上'), x: 1100, y: -20, width: 100, height: 30 },
  ]);
  expect(added).toMatchObject({ parentId: 'c4' });
  expect(explicit).toMatchObject({ parentId: '$other' });
  expect(header).not.toHaveProperty('parentId');
});

it('阅读顺序把分区当作一块：先读分区，再读完区内成员，才轮到区外的下一项', () => {
  const elements: CanvasElement[] = [card('c9', 0, 0), section('c1', 200, 0), card('c3', 300, 200, 'c1'), card('c2', 220, 60, 'c1'), card('c5', 700, 0)];
  const cards = elements.filter(element => element.type !== 'edge');
  expect(orderCanvasCardsForReading(cards, readCanvasCardConnections(elements)).map(item => item.id)).toEqual(['c9', 'c1', 'c2', 'c3', 'c5']);
});
