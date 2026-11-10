import { expect, it } from 'vitest';
import { CanvasSnapshotSchema, createCanvasPlainTextDocument } from '../../../../shared';
import { checkCanvas, queryCanvas } from '../index';
const source = { kind: 'user', conversationId: null, runId: null };
const identity = { schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 1, updatedAt: 1 };
function card(id: string, x: number, y: number) { return { ...identity, id, type: 'text', x, y, width: 100, height: 80, parentId: null, data: { contentVersion: 1, content: createCanvasPlainTextDocument(id === 'c1' ? '待定方案' : '已确认') } }; }
function edge(id: string, from: string, to: string) { return { ...identity, id, type: 'edge', from: { kind: 'card', cardId: from, side: 'auto' }, to: { kind: 'card', cardId: to, side: 'auto' }, direction: 'forward', lineStyle: 'straight', label: '' }; }
it('checks the same edge geometry used by the renderer and bounds diagnostic samples', () => {
  const snapshot = CanvasSnapshotSchema.parse({ schemaVersion: 1, documentId: 'canvas', sequence: 1,
    elements: [card('c1', 0, 0), card('c2', 400, 400), card('c3', 400, 0), card('c4', 0, 400), edge('e1', 'c1', 'c2'), edge('e2', 'c3', 'c4')] });
  expect(checkCanvas(snapshot)).toMatchObject({ overlapCount: 0, crossingCount: 1, crossings: [['e1', 'e2']] });
  const dense = CanvasSnapshotSchema.parse({ ...snapshot, elements: Array.from({ length: 20 }, (_, index) => card(`c${index + 1}`, 0, 0)) });
  expect(checkCanvas(dense)).toMatchObject({ overlapCount: 190 }); expect(checkCanvas(dense).overlaps).toHaveLength(100);
});
it('queries exact local identities, neighbors and available document titles without exposing missing targets', () => {
  const snapshot = CanvasSnapshotSchema.parse({ schemaVersion: 1, documentId: 'canvas', sequence: 2,
    elements: [card('c1', 0, 0), card('c2', 400, 0), edge('e1', 'c1', 'c2'), { ...card('c3', 800, 0), type: 'document', data: { documentId: 'private-target-id' } }] });
  const context = { name: '讨论', documentPaths: new Map<string, string>(), documentTitles: new Map<string, string>() };
  expect(queryCanvas(snapshot, context, { kind: 'find', value: '待定', depth: 1 })).toMatchObject({ total: 1, matches: [{ id: 'c1' }] });
  expect(queryCanvas(snapshot, context, { kind: 'neighbors', value: 'c1', depth: 1 })).toMatchObject({ elements: [{ id: 'c1' }, { id: 'c2' }], edges: [{ id: 'e1' }] });
  expect(JSON.stringify(queryCanvas(snapshot, context, { kind: 'show', value: 'c3', depth: 1 }))).not.toContain('private-target-id');
  expect(() => queryCanvas(snapshot, context, { kind: 'region', value: '不存在', depth: 1 })).toThrow('方位');
});

it('renders semantic scopes and includes free endpoints in whole-document framing', async () => {
  const { readCanvasRenderRegion } = await import('../index');
  const { canvasRenderRectangles } = await import('../../../../shared/rendering/functions/canvasRenderRectangles');
  const snapshot = CanvasSnapshotSchema.parse({ schemaVersion: 1, documentId: 'canvas', sequence: 2, elements: [card('c1', 0, 0), card('c2', 500, 500),
    { ...edge('e1', 'c1', 'c2'), from: { kind: 'point', x: 5000, y: 5000 }, to: { kind: 'point', x: 6000, y: 6000 } }] });
  expect(readCanvasRenderRegion(snapshot, { elementIds: ['c2'] })).toEqual({ x: 500, y: 500, width: 100, height: 80 });
  expect(() => readCanvasRenderRegion(snapshot, { elementIds: ['c9'] })).toThrow('canvas_element_not_found');
  const bottomRight = readCanvasRenderRegion(snapshot, { region: '右下' });
  expect(bottomRight && bottomRight.x + bottomRight.width).toBeGreaterThan(6000);
  expect(canvasRenderRectangles(snapshot.elements)).toHaveLength(4);
});
