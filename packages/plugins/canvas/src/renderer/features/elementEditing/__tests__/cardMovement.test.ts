import { expect, it, vi } from 'vitest';
import { CanvasTextCardSchema, type CanvasCommitResult } from '@plugin/canvas/shared';
import { createCanvasDocumentSession, type CanvasDocumentPort } from '../../canvasDocument';
import { createCanvasCardMovement } from '..';
it('连续键盘微移累加到最新已接纳修订，最后屏障等待全部提交', async () => {
  let card = CanvasTextCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, x: 0, y: 0, width: 280, height: 180, parentId: null, data: { contentVersion: 1, content: { type: 'doc', content: [] } } }), sequence = 0;
  const snapshot = () => ({ schemaVersion: 1 as const, documentId: 'doc', sequence, elements: [card] });
  const port: CanvasDocumentPort = { read: async () => snapshot(), changes: async () => ({ kind: 'snapshot', snapshot: snapshot() }), editing: async () => {}, undo: vi.fn(), close: async () => {}, subscribe: () => () => {},
    async commit(input): Promise<CanvasCommitResult> { await Promise.resolve(); const operation = input.operations[0]; if (operation?.op !== 'update' || operation.baseRevision !== card.revision) throw new Error('stale_field'); card = CanvasTextCardSchema.parse({ ...card, ...operation.patch, revision: card.revision + 1 }); sequence++; return { documentId: 'doc', requestId: input.requestId, sequence, refs: {}, results: [{ index: 0, id: card.id, status: 'applied', reason: null }] }; },
  };
  const session = createCanvasDocumentSession(port); await session.open('doc'); const movement = createCanvasCardMovement(session, async () => {});
  const actions = Array.from({ length: 20 }, () => movement.move([card.id], 10, 0));
  await movement.flush(); await Promise.all(actions); expect(card.x).toBe(200); expect(card.revision).toBe(21); await session.close();
});
