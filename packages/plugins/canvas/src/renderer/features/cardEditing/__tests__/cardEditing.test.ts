import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvasCardEditor } from '..';
import { createCanvasDocumentSession } from '../../canvasDocument';
import { CanvasTextCardSchema, createCanvasPlainTextDocument, type CanvasSnapshot, type CanvasCommitResult } from '@plugin/canvas/shared';
import type { CanvasDocumentPort } from '../../canvasDocument';

const initial = CanvasTextCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', color: 'white', locked: false,
  createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null },
  createdAt: 1, updatedAt: 1, x: 0, y: 0, width: 280, height: 180, parentId: null, data: { contentVersion: 1, content: createCanvasPlainTextDocument('before') } });

async function fixture(heightMode: 'auto' | 'fixed' = 'auto') {
  let snapshot: CanvasSnapshot = { schemaVersion: 1, documentId: 'doc', sequence: 0, elements: [{ ...initial, data: { ...initial.data, heightMode } }] };
  const commit = vi.fn(async (input: Parameters<CanvasDocumentPort['commit']>[0]): Promise<CanvasCommitResult> => {
    const operation = input.operations[0];
    if (operation?.op !== 'update') throw new Error('expected update');
    const current = snapshot.elements[0];
    if (!current || current.type !== 'text') throw new Error('expected card');
    snapshot = { ...snapshot, sequence: snapshot.sequence + 1, elements: [CanvasTextCardSchema.parse({ ...current, ...operation.patch, revision: current.revision + 1 })] };
    return { documentId: 'doc', requestId: input.requestId, sequence: snapshot.sequence, results: [{ index: 0, id: 'c1', status: 'applied', reason: null }], refs: {} };
  });
  const protection = vi.fn(async () => {});
  const session = createCanvasDocumentSession({ read: async () => snapshot, changes: async () => ({ kind: 'snapshot', snapshot }), commit, editing: protection, close: async () => {}, undo: async () => { throw new Error('not used'); }, subscribe: () => () => {} });
  await session.open('doc');
  const editor = createCanvasCardEditor(session);
  await editor.open(initial.id);
  return { session, editor, commit, protection };
}

afterEach(() => vi.restoreAllMocks());
describe('文字草稿提交屏障', () => {
  it('保存失败保留正文与dirty，重试后退出并释放字段保护', async () => {
    const f = await fixture();
    f.editor.update(createCanvasPlainTextDocument('new'));
    f.commit.mockRejectedValueOnce(new Error('storage failed'));
    expect(await f.editor.save(true)).toBe(false);
    expect(f.editor.state.draft.value?.content).toEqual(createCanvasPlainTextDocument('new'));
    expect(f.editor.state.error.value).toBe('storage failed');
    expect(await f.editor.save(true)).toBe(true);
    expect(f.editor.state.draft.value).toBeNull();
    expect(f.protection).toHaveBeenLastCalledWith(expect.objectContaining({ fields: [] }));
    f.editor.dispose(); f.session.close();
  });

  it('组合输入不提交；连续自动保存沿用同一文字编辑撤销组', async () => {
    const f = await fixture();
    f.editor.update(createCanvasPlainTextDocument('one'));
    f.editor.setComposing(true);
    expect(await f.editor.save(true)).toBe(false);
    expect(f.commit).not.toHaveBeenCalled();
    f.editor.setComposing(false);
    expect(await f.editor.save()).toBe(true);
    f.editor.update(createCanvasPlainTextDocument('two'));
    expect(await f.editor.save(true)).toBe(true);
    expect(f.commit.mock.calls[0]?.[0].historyGroupId).toBe(f.commit.mock.calls[1]?.[0].historyGroupId);
    expect(f.commit.mock.calls[1]?.[0].operations[0]).toMatchObject({ baseRevision: 2 });
    f.editor.dispose(); f.session.close();
  });

  it('自动高度使用共享上限，固定高度的卡不会被正文测量改高', async () => {
    const auto = await fixture(); auto.editor.update(createCanvasPlainTextDocument('长正文')); auto.editor.measure(10000);
    expect(await auto.editor.save()).toBe(true);
    expect(auto.commit.mock.calls[0]?.[0].operations[0]).toMatchObject({ patch: { height: 1800, data: { heightMode: 'auto' } } });
    auto.editor.dispose(); await auto.session.close();
    const fixed = await fixture('fixed'); fixed.editor.update(createCanvasPlainTextDocument('长正文')); fixed.editor.measure(10000);
    expect(await fixed.editor.save()).toBe(true);
    const command = fixed.commit.mock.calls[0]?.[0].operations[0];
    expect(command?.op === 'update' && command.patch.height).toBeUndefined();
    fixed.editor.dispose(); await fixed.session.close();
  });

  it('保存期间的新输入不会被清掉；退出需再次保存最新内容', async () => {
    const f = await fixture();
    const original = f.commit.getMockImplementation();
    let resume: (() => void) | undefined;
    f.commit.mockImplementationOnce(async input => { await new Promise<void>(resolve => { resume = resolve; }); if (!original) throw new Error('missing fixture'); return original(input); });
    f.editor.update(createCanvasPlainTextDocument('one'));
    const saving = f.editor.save(true);
    await Promise.resolve(); await Promise.resolve();
    f.editor.update(createCanvasPlainTextDocument('two'));
    resume?.();
    expect(await saving).toBe(false);
    expect(f.editor.state.draft.value?.content).toEqual(createCanvasPlainTextDocument('two'));
    expect(await f.editor.save(true)).toBe(true);
    f.editor.dispose(); f.session.close();
  });
});
