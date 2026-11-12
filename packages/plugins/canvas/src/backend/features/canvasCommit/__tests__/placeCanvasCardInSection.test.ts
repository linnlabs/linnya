import { expect, it } from 'vitest';
import {
  CanvasSectionCardSchema,
  CanvasTextCardSchema,
  createCanvasPlainTextDocument,
  type CanvasCard,
} from '../../../../shared';
import { placeCanvasCardInSection } from '../functions/placeCanvasCardInSection';

const source = { kind: 'user', conversationId: null, runId: null } as const;
const identity = { schemaVersion: 1, revision: 1, color: 'white', locked: false, createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0 } as const;
const card = (id: string, order: string, x: number, y: number, parentId: string | null) =>
  CanvasTextCardSchema.parse({ ...identity, type: 'text', id, order, x, y, width: 100, height: 60, parentId, data: { contentVersion: 1, content: createCanvasPlainTextDocument(id), heightMode: 'auto' } });
const section = (id: string, x: number, y: number, width: number, height: number) =>
  CanvasSectionCardSchema.parse({ ...identity, type: 'section', id, order: 'a0', x, y, width, height, parentId: null, data: { title: id } });
const plan = (elements: readonly CanvasCard[]) =>
  ({ elements: new Map(elements.map(element => [element.id, { element }])), reservedRectangles: [] }) as never;

it('区内一行放满后换到本区下一行；下方相邻分区和它的成员不把新卡挤出本区', () => {
  // 区 c1 一行已放满三张卡；相邻分区 c5 紧贴在它下面，新卡的下一行正好落在 c5 和它的成员上。
  const a = section('c1', 0, 0, 400, 130);
  const elements = [a, card('c2', 'a1', 24, 48, 'c1'), card('c3', 'a2', 156, 48, 'c1'), card('c4', 'a3', 288, 48, 'c1'),
    section('c5', 0, 140, 400, 200), card('c6', 'a4', 24, 170, 'c5')];
  expect(placeCanvasCardInSection(plan(elements), { width: 100, height: 60 }, a)).toEqual({ x: 24, y: 140 });
});

it('区内放卡仍避开不在任何分区里的卡', () => {
  const a = section('c1', 0, 0, 400, 200);
  const elements = [a, card('c2', 'a1', 24, 48, 'c1'), card('c9', 'a2', 156, 48, null)];
  const placed = placeCanvasCardInSection(plan(elements), { width: 100, height: 60 }, a);
  expect(placed.x >= 256 || placed.y >= 108).toBe(true);
});
