// @vitest-environment jsdom
import { nextTick, shallowRef } from 'vue';
import { expect, it, vi } from 'vitest';
import { CanvasCardIdSchema, CanvasTextCardSchema, createCanvasPlainTextDocument } from '@plugin/canvas/shared';
import { createCanvasDocumentSession, type CanvasDocumentPort } from '../../features/canvasDocument';
import { createCanvasCardEditor } from '../../features/cardEditing';
import { createCanvasTextCreation } from '../../features/textCreation';
import { installCanvasEditorProjection } from '../installCanvasEditorProjection';
it('首次保存保留同一个DOM编辑身份，切到真实卡时不取消正在准备的插图锚点', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const card = CanvasTextCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, x: 0, y: 0, width: 280, height: 180, parentId: null, data: { contentVersion: 1, content: createCanvasPlainTextDocument('新内容') } });
  const port: CanvasDocumentPort = { read: async () => ({ schemaVersion: 1, documentId: 'doc', sequence: 0, elements: [card] }), changes: vi.fn(), editing: async () => {}, undo: vi.fn(), close: async () => {}, subscribe: () => () => {}, commit: async input => ({ documentId: 'doc', requestId: input.requestId, sequence: 0, results: [{ index: 0, id: card.id, status: 'applied', reason: null }], refs: { $created: CanvasCardIdSchema.parse('c1') } }) };
  const session = createCanvasDocumentSession(port); await session.open('doc'); const editor = createCanvasCardEditor(session);
  const creation = createCanvasTextCreation(session, async (id, continuing, remaining, identity) => { if (continuing) { await editor.open(id, identity); const content = remaining(); if (content) editor.update(content); } });
  const editable = { replaceContent: vi.fn(), focus: vi.fn() }, setEditingCard = vi.fn(), detailId = shallowRef<ReturnType<typeof CanvasCardIdSchema.parse> | null>(null);
  const projection = installCanvasEditorProjection({ host: document.createElement('div'), editor, creation, editable, kernel: { setEditingCard }, camera: shallowRef({ x: 0, y: 0, zoom: 1 }), detailId, cards: () => [card], setDirty: vi.fn(), refresh: vi.fn() });
  creation.begin({ x: 0, y: 0 }, null, '新内容'); await nextTick(); expect(editable.replaceContent).toHaveBeenCalledTimes(1);
  await creation.save(false); await nextTick(); expect(editable.replaceContent).toHaveBeenCalledTimes(1); expect(setEditingCard).toHaveBeenLastCalledWith(card.id);
  detailId.value = CanvasCardIdSchema.parse('c9'); expect(setEditingCard).toHaveBeenLastCalledWith(card.id);
  await editor.save(true); expect(setEditingCard).toHaveBeenLastCalledWith(detailId.value);
  detailId.value = null; expect(setEditingCard).toHaveBeenLastCalledWith(null);
  projection.dispose(); editor.dispose(); await session.close(); vi.unstubAllGlobals();
});
