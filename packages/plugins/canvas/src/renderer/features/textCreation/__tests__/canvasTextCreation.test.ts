import { expect, it, vi } from 'vitest';
import { CanvasCardIdSchema, createCanvasPlainTextDocument, type CanvasCommitResult, type CanvasCardId, type CanvasTextDocument } from '@plugin/canvas/shared';
import { CanvasDeliveryUnknownError, createCanvasDocumentSession, type CanvasDocumentPort } from '../../canvasDocument';
import { createCanvasTextCreation } from '..';
async function fixture() {
  const commit = vi.fn(async (input: Parameters<CanvasDocumentPort['commit']>[0]): Promise<CanvasCommitResult> => ({ documentId: 'doc', requestId: input.requestId, sequence: 0, results: input.operations.map((_, index) => ({ index, status: 'applied', id: null, reason: null })), refs: { $created: CanvasCardIdSchema.parse('c2') } }));
  const port: CanvasDocumentPort = { read: async () => ({ schemaVersion: 1, documentId: 'doc', sequence: 0, elements: [] }), commit, changes: vi.fn(), editing: async () => {}, undo: vi.fn(), close: async () => {}, subscribe: () => () => {} };
  const session = createCanvasDocumentSession(port); await session.open('doc');
  const committed = vi.fn<(id: CanvasCardId, editing: boolean, remaining: () => CanvasTextDocument | null, historyGroupId: string) => Promise<void>>(async () => {}); return { creation: createCanvasTextCreation(session, committed), commit, committed, session };
}
it('空白创建只存在本地，Escape/blur结束不写库也不进入撤销历史', async () => {
  const f = await fixture(); f.creation.begin({ x: 20, y: 30 }, { kind: 'card', cardId: CanvasCardIdSchema.parse('c1'), side: 'right' });
  f.creation.update(createCanvasPlainTextDocument('  ')); expect(await f.creation.save(true)).toBe(true);
  expect(f.creation.state.draft.value).toBeNull(); expect(f.commit).not.toHaveBeenCalled(); expect(f.committed).not.toHaveBeenCalled(); await f.session.close();
});
it('文字卡和连线只在首次有效保存时共同提交，保持松手边中点', async () => {
  const f = await fixture(); const from = { kind: 'card' as const, cardId: CanvasCardIdSchema.parse('c1'), side: 'right' as const };
  f.creation.begin({ x: 20, y: 100 }, from); f.creation.measure(80); f.creation.update(createCanvasPlainTextDocument('新想法'));
  expect(await f.creation.save(true)).toBe(true); expect(f.commit).toHaveBeenCalledTimes(1);
  expect(f.commit.mock.calls[0]?.[0]).toMatchObject({ operations: [{ op: 'addText', ref: '$created', x: 20, y: 60, height: 80 }, { op: 'connect', from: { ...from, side: 'auto' }, to: '$created' }] });
  expect(f.committed).toHaveBeenCalledWith(CanvasCardIdSchema.parse('c2'), false, expect.any(Function), f.commit.mock.calls[0]?.[0].historyGroupId); expect(f.committed.mock.calls[0]?.[2]()).toBeNull(); await f.session.close();
});
it('请求期间的继续输入交给已创建卡片，不丢字；失败保留创建草稿', async () => {
  const f = await fixture(); let remaining: CanvasTextDocument | null = null; f.committed.mockImplementation(async (_id, _editing, read) => { remaining = read(); }); let resolve!: (value: CanvasCommitResult) => void;
  f.commit.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  f.creation.begin({ x: 0, y: 0 }); f.creation.update(createCanvasPlainTextDocument('第一版')); const saving = f.creation.save(false); await Promise.resolve();
  f.creation.update(createCanvasPlainTextDocument('第二版')); resolve({ documentId: 'doc', requestId: 'request', sequence: 0, results: [{ index: 0, id: CanvasCardIdSchema.parse('c2'), status: 'applied', reason: null }], refs: { $created: CanvasCardIdSchema.parse('c2') } }); await saving;
  expect(f.committed).toHaveBeenCalledWith(CanvasCardIdSchema.parse('c2'), true, expect.any(Function), expect.any(String)); expect(remaining).toEqual(createCanvasPlainTextDocument('第二版'));
  f.creation.begin({ x: 0, y: 0 }, null, '保留'); f.commit.mockRejectedValueOnce(new Error('save failed'));
  expect(await f.creation.save(true)).toBe(false); expect(f.creation.state.draft.value?.content).toEqual(createCanvasPlainTextDocument('保留')); await f.session.close();
});
it('回包丢失后确认只重发冻结正文，新输入在接纳真实卡片后继续；连线部分跳过也不重复建卡', async () => {
  const f = await fixture(); let remaining: CanvasTextDocument | null = null;
  f.committed.mockImplementation(async (_id, _editing, read) => { remaining = read(); });
  f.commit.mockRejectedValueOnce(new CanvasDeliveryUnknownError('response lost'));
  f.creation.begin({ x: 0, y: 0 }, null, '第一版'); const saving = f.creation.save(false);
  await vi.waitFor(() => expect(f.session.deliveryNotice.value).not.toBeNull());
  f.creation.update(createCanvasPlainTextDocument('第二版')); await f.session.retryDelivery(); expect(await saving).toBe(true);
  expect(f.commit.mock.calls[0]?.[0]).toEqual(f.commit.mock.calls[1]?.[0]); expect(remaining).toEqual(createCanvasPlainTextDocument('第二版'));
  f.creation.begin({ x: 0, y: 0 }, { kind: 'card', cardId: CanvasCardIdSchema.parse('c99'), side: 'right' }, '保留已创建正文');
  f.commit.mockResolvedValueOnce({ documentId: 'doc', requestId: 'partial', sequence: 0, results: [{ index: 0, status: 'applied', id: CanvasCardIdSchema.parse('c2'), reason: null }, { index: 1, status: 'skipped', id: null, reason: 'missing_endpoint' }], refs: { $created: CanvasCardIdSchema.parse('c2') } });
  expect(await f.creation.save(true)).toBe(true); expect(f.creation.state.draft.value).toBeNull(); expect(f.creation.state.error.value).toContain('已提交 1 项');
  await f.creation.save(true); expect(f.commit).toHaveBeenCalledTimes(3); await f.session.close();
});
