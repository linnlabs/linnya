import { expect, it } from 'vitest';
import { CanvasTextCardSchema, CanvasSynchronizationSchema, type CanvasSynchronization } from '@plugin/canvas/shared';
import { canvasProjectionMotion } from '../../functions/canvasProjectionMotion';
import { createCanvasDocumentSession } from '../../features/canvasDocument';
import { canvasDraggedCopySource } from '../../functions/canvasDraggedCopySource';
function card(index: number, x = 0) { return CanvasTextCardSchema.parse({ schemaVersion: 1, id: `c${index}`, type: 'text', revision: 1, order: `a${index}`, color: 'white', locked: false, createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, x, y: 0, width: 100, height: 50, parentId: null, data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] } } }); }
it('混合追平仅动画每卡最后一批Agent来源，保留新增/删除，不把用户改动和旧快照误判成Agent', async () => {
  const first = card(1), removed = card(2), added = card(3), moved = { ...first, revision: 2, x: 80 }, user = { ...moved, revision: 3, color: 'red' };
  const update = CanvasSynchronizationSchema.parse({ kind: 'delta', documentId: 'doc', fromSequence: 0, sequence: 2, commits: [
    { sequence: 1, source: { kind: 'agent', conversationId: 'chat', runId: 'run' }, changes: [{ id: first.id, before: first, after: moved, fields: ['x'] }, { id: added.id, before: null, after: added, fields: [] }, { id: removed.id, before: removed, after: null, fields: [] }] },
    { sequence: 2, source: { kind: 'user', conversationId: null, runId: null }, changes: [{ id: first.id, before: moved, after: user, fields: ['color'] }] },
  ] });
  const snapshot = { schemaVersion: 1 as const, documentId: 'doc', sequence: 0, elements: [first, removed] };
  let response: CanvasSynchronization = update;
  const session = createCanvasDocumentSession({ read: async () => snapshot, changes: async () => response, commit: async () => { throw new Error('unused'); }, editing: async () => {}, close: async () => {}, undo: async () => { throw new Error('unused'); }, subscribe: () => () => {} });
  await session.open('doc'); expect(session.state.projection.value?.cardChanges).toEqual([]);
  await session.synchronize(2); const projection = session.state.projection.value;
  expect(projection?.snapshot.sequence).toBe(2); expect(session.state.snapshot.value).toBe(projection?.snapshot);
  expect(projection?.cardChanges).toEqual([{ id: first.id, sourceKind: 'user' }, { id: added.id, sourceKind: 'agent' }, { id: removed.id, sourceKind: 'agent' }]);
  if (!projection) throw new Error('missing projection');
  expect(canvasProjectionMotion(projection)).toEqual({ animateIds: [added.id, removed.id], batch: false });
  response = { kind: 'snapshot', snapshot: { ...projection.snapshot, sequence: 3 } }; await session.synchronize(3);
  expect(session.state.projection.value?.cardChanges).toEqual([]);
  await session.close(); expect(session.state.projection.value).toBeNull();
});
it('超过200张Agent卡才用整批动效', () => {
  const changes = (count: number) => Array.from({ length: count }, (_, index) => ({ id: card(index + 1).id, sourceKind: 'agent' as const }));
  const snapshot = { schemaVersion: 1 as const, documentId: 'doc', sequence: 0, elements: [] };
  expect(canvasProjectionMotion({ snapshot, cardChanges: changes(200) }).batch).toBe(false);
  expect(canvasProjectionMotion({ snapshot, cardChanges: changes(201) }).batch).toBe(true);
});
it('Alt拖拽复制采用视觉起点，正式卡片内容和锁定等属性原样保留', () => {
  const original = card(1, 300), positions = [{ id: original.id, x: 110, y: 40 }];
  const copied = canvasDraggedCopySource([original], positions, 20, 10);
  expect(copied[0]).toMatchObject({ id: original.id, x: 90, y: 30, revision: original.revision, data: original.data });
  expect(original.x).toBe(300);
});
