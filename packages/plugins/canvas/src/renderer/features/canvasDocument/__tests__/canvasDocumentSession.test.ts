import { describe, expect, it, vi } from 'vitest';
import type { CanvasCommitResult, CanvasSnapshot, CanvasSynchronization } from '@plugin/canvas/shared';
import { createCanvasDocumentSession } from '..';
import type { CanvasDocumentPort } from '..';

function snapshot(documentId: string, sequence = 0): CanvasSnapshot {
  return { schemaVersion: 1, documentId, sequence, elements: [] };
}
function fixture() {
  let sequence = 0;
  let push: ((event: { documentId: string; sequence: number }) => void) | null = null;
  const read = vi.fn(async (id: string) => snapshot(id));
  const changes = vi.fn(async (documentId: string, afterSequence: number): Promise<CanvasSynchronization> => ({ kind: 'delta', documentId, fromSequence: afterSequence, sequence, commits: Array.from({ length: sequence - afterSequence }, (_, index) => ({ sequence: afterSequence + index + 1, source: { kind: 'user', conversationId: null, runId: null }, changes: [] })) }));
  const commit = vi.fn(async (input: Parameters<CanvasDocumentPort['commit']>[0]): Promise<CanvasCommitResult> => ({ documentId: input.documentId, requestId: input.requestId, sequence: ++sequence, results: [], refs: {} }));
  const editing = vi.fn(async () => {});
  const unsubscribe = vi.fn();
  const port: CanvasDocumentPort = { read, changes, commit, editing, close: async () => {}, undo: async () => { throw new Error('not used'); }, subscribe(callback) { push = callback; return unsubscribe; } };
  return { read, changes, commit, editing, unsubscribe, session: createCanvasDocumentSession(port), push(value: number) { sequence = value; push?.({ documentId: 'doc', sequence }); } };
}

describe('Canvas document session', () => {
  it('打开→提交→连续增量→关闭，不为每次提交重读全量文档', async () => {
    const f = fixture();
    await f.session.open('doc');
    await f.session.commit([{ op: 'addText', width: 280, height: 180, content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] } }]);
    expect(f.session.state.snapshot.value?.sequence).toBe(1);
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.changes).toHaveBeenCalledWith('doc', 0);
    expect(f.commit.mock.calls[0]?.[0].viewId).toBe(f.session.viewId);
    f.session.close();
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect(f.session.state.snapshot.value).toBeNull();
  });

  it('正文与拖动分别持有保护，结束正文编辑不会清掉仍在拖动的坐标字段', async () => {
    const f = fixture(); await f.session.open('doc');
    const id = (await import('@plugin/canvas/shared')).CanvasCardIdSchema.parse('c1');
    await f.session.protect(id, ['data'], 'text');
    await f.session.protect(id, ['x', 'y'], 'drag');
    expect(f.editing).toHaveBeenLastCalledWith(expect.objectContaining({ fields: ['data', 'x', 'y'] }));
    await f.session.protect(id, [], 'text');
    expect(f.editing).toHaveBeenLastCalledWith(expect.objectContaining({ fields: ['x', 'y'] }));
    await f.session.protect(id, [], 'drag');
    expect(f.editing).toHaveBeenLastCalledWith(expect.objectContaining({ fields: [] }));
    await f.session.close();
  });

  it('A→B→A 的旧异步响应不能装进新的文档会话', async () => {
    const f = fixture();
    let finishOld: ((value: CanvasSnapshot) => void) | undefined;
    f.read.mockImplementationOnce(async () => new Promise(resolve => { finishOld = resolve; }));
    const old = f.session.open('a');
    await f.session.open('b');
    finishOld?.(snapshot('a', 10));
    await old;
    expect(f.session.state.snapshot.value?.documentId).toBe('b');
    expect(f.session.state.snapshot.value?.sequence).toBe(0);
  });

  it('日志被裁剪时经正式 snapshot 恢复，旧重复推送不触发重读', async () => {
    const f = fixture();
    await f.session.open('doc');
    f.changes.mockResolvedValueOnce({ kind: 'snapshot', snapshot: snapshot('doc', 5) });
    await f.session.synchronize(5);
    expect(f.session.state.snapshot.value?.sequence).toBe(5);
    await f.session.synchronize(4);
    expect(f.changes).toHaveBeenCalledTimes(1);
  });

  it('乱序或缺口不是合法成功，保留最后快照并报告失败', async () => {
    const f = fixture();
    await f.session.open('doc');
    f.changes.mockResolvedValueOnce({ kind: 'delta', documentId: 'doc', fromSequence: 3, sequence: 4, commits: [] });
    await expect(f.session.synchronize(4)).rejects.toThrow('does not continue');
    expect(f.session.state.snapshot.value?.sequence).toBe(0);
    expect(f.session.state.phase.value).toBe('failed');
  });

  it('部分提交先同步正式序号再说明跳过，失败不阻塞下一次独立动作', async () => {
    const f = fixture(); await f.session.open('doc');
    const commit = f.commit.getMockImplementation(); if (!commit) throw new Error('fixture commit missing');
    f.commit.mockImplementationOnce(async input => ({ ...await commit(input), results: [{ index: 0, status: 'applied', id: null, reason: null }, { index: 1, status: 'skipped', id: null, reason: 'revision_conflict' }] }));
    const operations = [{ op: 'delete' as const, id: 'c1', baseRevision: 1 }];
    await expect(f.session.commit(operations)).rejects.toThrow('已提交 1 项，另有 1 项跳过');
    expect(f.session.state.snapshot.value?.sequence).toBe(1);
    await f.session.commit(operations); expect(f.session.state.snapshot.value?.sequence).toBe(2);
    await f.session.close();
  });

  it('同一operation部分字段成功先接纳实际提交，再明确拒绝全成功以保留调用方草稿', async () => {
    const f = fixture(); await f.session.open('doc');
    const commit = f.commit.getMockImplementation(); if (!commit) throw new Error('fixture commit missing');
    f.commit.mockImplementationOnce(async input => ({ ...await commit(input), results: [{ index: 0, status: 'applied', id: null, reason: 'partial_fields_skipped', fieldResults: [{ field: 'color', status: 'applied', reason: null }, { field: 'data', status: 'skipped', reason: 'stale_field' }] }] }));
    await expect(f.session.commit([{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'red', data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] } } } }])).rejects.toMatchObject({ name: 'Error', result: { sequence: 1 } });
    expect(f.session.state.snapshot.value?.sequence).toBe(1);
    expect(f.session.mutationPending.value).toBe(false);
    await f.session.close();
  });
  it('读到兼容性只读快照后不发送写入或续约，已有保护仍能释放', async () => {
    const f = fixture(); await f.session.open('doc');
    const id = (await import('@plugin/canvas/shared')).CanvasCardIdSchema.parse('c1');
    await f.session.protect(id, ['data'], 'text');
    f.changes.mockResolvedValueOnce({ kind: 'snapshot', snapshot: { ...snapshot('doc', 1), integrity: { readOnly: true, formatVersion: 2, issues: [{ elementId: null, code: 'future_format', message: '新格式' }] } } });
    await f.session.synchronize(1);
    expect(() => f.session.commit([])).toThrow('只读');
    expect(() => f.session.undo('undo')).toThrow('只读');
    await expect(f.session.protect(id, ['data'], 'text')).rejects.toThrow('只读');
    await f.session.protect(id, [], 'text');
    expect(f.editing).toHaveBeenLastCalledWith(expect.objectContaining({ fields: [] }));
    expect(f.commit).not.toHaveBeenCalled(); await f.session.close();
  });
});
