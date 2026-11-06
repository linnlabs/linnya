import { afterEach, expect, it, vi } from 'vitest';
import { CanvasCardIdSchema, CanvasTextCardSchema, createCanvasPlainTextDocument, type CanvasSnapshot } from '@plugin/canvas/shared';
import { createCanvasCardEditor } from '..';
import { createCanvasDocumentSession, type CanvasDocumentPort } from '../../canvasDocument';

const c1 = CanvasCardIdSchema.parse('c1'), c2 = CanvasCardIdSchema.parse('c2');
function card(id: string) {
  return CanvasTextCardSchema.parse({ id, type: 'text', schemaVersion: 1, revision: 1, order: id, color: 'white', locked: false, createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 1, updatedAt: 1, x: 0, y: 0, width: 280, height: 180, parentId: null, data: { contentVersion: 1, content: createCanvasPlainTextDocument(id === 'c1' ? '第一张' : '第二张') } });
}
async function fixture() {
  let snapshot: CanvasSnapshot = { documentId: 'doc', sequence: 0, schemaVersion: 1, elements: [card('c1'), card('c2')] };
  let delayNext = false, release: (() => void) | undefined;
  const editing = vi.fn(async (_input: Parameters<CanvasDocumentPort['editing']>[0]) => { if (delayNext) { delayNext = false; await new Promise<void>(resolve => { release = resolve; }); } });
  const close = vi.fn(async () => {});
  const session = createCanvasDocumentSession({ read: async () => snapshot, changes: async () => ({ kind: 'snapshot', snapshot }), editing, close, subscribe: () => () => {}, undo: async () => { throw new Error('unused'); },
    commit: async input => {
      snapshot = { ...snapshot, sequence: snapshot.sequence + 1, elements: snapshot.elements.map(element => { const command = input.operations.find(command => command.op === 'update' && command.id === element.id); return command?.op === 'update' ? CanvasTextCardSchema.parse({ ...element, ...command.patch, revision: element.revision + 1 }) : element; }) };
      return { documentId: 'doc', requestId: input.requestId, sequence: snapshot.sequence, results: input.operations.map((operation, index) => ({ index, status: 'applied', id: operation.op === 'update' ? CanvasCardIdSchema.parse(operation.id) : null, reason: null })), refs: {} };
    },
  });
  await session.open('doc'); const editor = createCanvasCardEditor(session);
  return { session, editor, editing, close, delay() { delayNext = true; release = undefined; }, async waiting() { await vi.waitFor(() => expect(release).toBeDefined()); }, resume() { release?.(); }, snapshot: () => snapshot, lastFields(elementId?: typeof c1) { const claims = editing.mock.calls.at(-1)?.[0].claims ?? []; return elementId ? claims.find(claim => claim.elementId === elementId)?.fields ?? [] : claims.flatMap(claim => claim.fields); } };
}
afterEach(() => vi.restoreAllMocks());
it('claim迟到时已切到另一卡，旧请求只释放旧owner且不装入旧草稿', async () => {
  const f = await fixture(), first = new AbortController(); f.delay();
  const a = f.editor.open(c1, undefined, first.signal); await f.waiting();
  first.abort(); const b = f.editor.open(c2); f.resume(); await Promise.all([a, b]);
  expect(f.editor.state.draft.value?.elementId).toBe(c2);
  expect(f.lastFields(c1)).toEqual([]);
  expect(f.lastFields(c2)).toEqual(['data', 'height']);
  f.editor.dispose(); await f.session.close();
});
it('同卡连续open的旧清理不清新owner，已进入编辑后abort opening不清正文', async () => {
  const f = await fixture(), first = new AbortController(), second = new AbortController(); f.delay();
  const a = f.editor.open(c1, 'first', first.signal); await f.waiting();
  const b = f.editor.open(c1, 'second', second.signal); first.abort(); f.resume(); await Promise.all([a, b]);
  expect(f.editor.state.draft.value?.historyGroupId).toBe('second');
  expect(f.lastFields()).toEqual(['data', 'height']);
  f.editor.update(createCanvasPlainTextDocument('新草稿')); second.abort();
  expect(f.editor.state.draft.value?.content).toEqual(createCanvasPlainTextDocument('新草稿'));
  expect(await f.editor.save(true)).toBe(true); expect(f.lastFields()).toEqual([]);
  f.editor.dispose(); await f.session.close();
});
it('关闭表面后claim返回不会重新打开正文或向已关闭会话发送旧释放', async () => {
  const f = await fixture(); f.delay(); const opening = f.editor.open(c1); await f.waiting();
  f.editor.dispose(); const closing = f.session.close(); f.resume(); await Promise.all([opening, closing]);
  expect(f.editor.state.draft.value).toBeNull(); expect(f.editing).toHaveBeenCalledOnce(); expect(f.close).toHaveBeenCalledOnce();
});
it('释放claim期间的新输入不被清除，继续保护并能保存最新草稿', async () => {
  const f = await fixture(); await f.editor.open(c1); f.delay(); const finishing = f.editor.save(true); await f.waiting();
  f.editor.update(createCanvasPlainTextDocument('释放期间继续输入')); f.resume(); expect(await finishing).toBe(false);
  expect(f.editor.state.draft.value?.content).toEqual(createCanvasPlainTextDocument('释放期间继续输入'));
  expect(f.lastFields()).toEqual(['data', 'height']);
  expect(await f.editor.save(true)).toBe(true); expect(f.snapshot().elements[0]).toMatchObject({ data: { content: createCanvasPlainTextDocument('释放期间继续输入') } });
  f.editor.dispose(); await f.session.close();
});
it('切卡保存屏障期间切回原卡，取消旧opening保留已保存内容的编辑会话', async () => {
  const f = await fixture(); await f.editor.open(c1); const controller = new AbortController();
  f.delay(); const opening = f.editor.open(c2, undefined, controller.signal); await f.waiting();
  controller.abort(); await f.editor.open(c1); f.resume(); await opening;
  expect(f.editor.state.draft.value?.elementId).toBe(c1); expect(f.editor.state.draft.value?.content).toEqual(createCanvasPlainTextDocument('第一张'));
  expect(f.lastFields()).toEqual(['data', 'height']);
  f.editor.dispose(); await f.session.close();
});
it('普通finish释放期间再次打开同卡仍保留草稿，不被旧finish迟到关闭', async () => {
  const f = await fixture(); await f.editor.open(c1); f.delay(); const finishing = f.editor.save(true); await f.waiting();
  await f.editor.open(c1); f.resume(); expect(await finishing).toBe(false);
  expect(f.editor.state.draft.value?.elementId).toBe(c1); expect(f.lastFields()).toEqual(['data', 'height']);
  f.editor.dispose(); await f.session.close();
});
it('只读降级suspend使未完成opening失效，迟到保护只释放且不创建草稿', async () => {
  const f = await fixture(); f.delay(); const opening = f.editor.open(c1); await f.waiting();
  await f.editor.suspend(); f.resume(); await opening;
  expect(f.editor.state.draft.value).toBeNull(); expect(f.lastFields()).toEqual([]);
  f.editor.dispose(); await f.session.close();
});
it('claim等待期间收到远端正文时，打开使用当前正式内容与修订而非发起时快照', async () => {
  const f = await fixture(); f.delay(); const opening = f.editor.open(c1); await f.waiting();
  const snapshot = f.session.state.snapshot.value; if (!snapshot) throw new Error('missing snapshot');
  f.session.state.install({ ...snapshot, sequence: 1, elements: snapshot.elements.map(element => element.id === c1 ? CanvasTextCardSchema.parse({ ...element, revision: 2, data: { contentVersion: 1, content: createCanvasPlainTextDocument('远端刚写入') } }) : element) });
  f.resume(); await opening;
  expect(f.editor.state.draft.value).toMatchObject({ baseRevision: 2, content: createCanvasPlainTextDocument('远端刚写入') });
  f.editor.dispose(); await f.session.close();
});
