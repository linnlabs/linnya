import { expect, it, vi } from 'vitest';
import { CanvasTextCardSchema, type CanvasCommitResult } from '@plugin/canvas/shared';
import { createCanvasDocumentSession, type CanvasDocumentPort } from '../../canvasDocument';
import { createCanvasCardMovement } from '..';
async function fixture(x = 0) {
  let card = CanvasTextCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, x, y: 0, width: 280, height: 180, parentId: null, data: { contentVersion: 1, content: { type: 'doc', content: [] } } }), sequence = 0;
  const snapshot = () => ({ schemaVersion: 1 as const, documentId: 'doc', sequence, elements: [card] });
  const port: CanvasDocumentPort = { read: async () => snapshot(), changes: async () => ({ kind: 'snapshot', snapshot: snapshot() }), editing: async () => {}, undo: vi.fn(), close: async () => {}, subscribe: () => () => {},
    async commit(input): Promise<CanvasCommitResult> { await Promise.resolve(); const operation = input.operations[0]; if (operation?.op !== 'update' || operation.baseRevision !== card.revision) throw new Error('stale_field'); card = CanvasTextCardSchema.parse({ ...card, ...operation.patch, revision: card.revision + 1 }); sequence++; return { documentId: 'doc', requestId: input.requestId, sequence, refs: {}, results: [{ index: 0, id: card.id, status: 'applied', reason: null }] }; },
  };
  const session = createCanvasDocumentSession(port); await session.open('doc'); const finish = vi.fn(async () => {}), movement = createCanvasCardMovement(session, finish);
  return { session, movement, finish, card: () => card };
}
it('连续键盘微移累加到最新已接纳修订，最后屏障等待全部提交', async () => {
  const { session, movement, card: readCard } = await fixture(), card = readCard();
  const actions = Array.from({ length: 20 }, () => movement.move([card.id], 10, 0));
  await movement.flush(); await Promise.all(actions); expect(readCard().x).toBe(200); expect(readCard().revision).toBe(21); await session.close();
});
it('动画中拖动提交视觉绝对终点，排队后仍使用最新修订；目标消失也释放原手势声明', async () => {
  const f = await fixture(300), id = f.card().id;
  const keyboard = f.movement.move([id], 10, 0), drag = f.movement.place([id], [{ id, x: 95, y: 20 }]);
  await Promise.all([keyboard, drag]); expect(f.card()).toMatchObject({ x: 95, y: 20, revision: 3 });
  await f.movement.place([id], []); expect(f.card().revision).toBe(3); expect(f.finish).toHaveBeenLastCalledWith([id]); await f.session.close();
});
