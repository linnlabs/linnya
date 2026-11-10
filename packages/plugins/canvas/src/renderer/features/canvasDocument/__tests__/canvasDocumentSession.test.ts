import { describe, expect, it, vi } from 'vitest';
import { watch } from 'vue';
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
  it('加载中关闭清理迟到Host视图，A→B→A的旧close不释放新文档', async () => {
    const response = Promise.withResolvers<CanvasSnapshot>(), started = Promise.withResolvers<void>();
    const registered = new Set<string>(), calls: string[] = [];
    let first = true;
    const session = createCanvasDocumentSession({
      read: async documentId => {
        calls.push(`read:${documentId}`); registered.add(documentId);
        if (first) { first = false; started.resolve(); return response.promise; }
        return snapshot(documentId);
      },
      close: async documentId => { calls.push(`close:${documentId}`); registered.delete(documentId); },
      changes: vi.fn(), commit: vi.fn(), editing: vi.fn(), undo: vi.fn(), subscribe: () => () => {},
    });
    const initial = session.open('a'); await started.promise;
    const closed = session.close(), middle = session.open('b'), latest = session.open('a');
    response.resolve(snapshot('a')); await Promise.all([initial, closed, middle, latest]);
    expect(calls).toEqual(['read:a', 'close:a', 'read:a']);
    expect(registered).toEqual(new Set(['a'])); expect(session.state.snapshot.value?.documentId).toBe('a');
    await session.close(); expect(registered.size).toBe(0);
  });
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
    expect(f.editing).toHaveBeenLastCalledWith(expect.objectContaining({ claims: [expect.objectContaining({ fields: ['data', 'x', 'y'] })] }));
    await f.session.protect(id, [], 'text');
    expect(f.editing).toHaveBeenLastCalledWith(expect.objectContaining({ claims: [expect.objectContaining({ fields: ['x', 'y'] })] }));
    await f.session.protect(id, [], 'drag');
    expect(f.editing).toHaveBeenLastCalledWith(expect.objectContaining({ claims: [] }));
    await f.session.close();
  });

  it('已校验响应等待场景安装时保留提交屏障，并在同一同步流程追平新推送', async () => {
    const f = fixture(); await f.session.open('doc');
    const started = Promise.withResolvers<void>(), response = Promise.withResolvers<CanvasSynchronization>();
    f.changes.mockImplementationOnce(() => { started.resolve(); return response.promise; });
    const installed: number[] = [];
    const stop = watch(f.session.state.projection, value => { if (value) installed.push(value.snapshot.sequence); }, { flush: 'sync' });
    vi.useFakeTimers();
    try {
      let confirmed = false;
      const pending = f.session.commit([{ op: 'addText', width: 280, height: 180, content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] } }]).then(() => { confirmed = true; });
      await started.promise;
      response.resolve({ kind: 'snapshot', snapshot: snapshot('doc', 1) });
      // 与会话等待同一个端口响应；回调已登记task，但尚未执行场景安装。
      await response.promise;
      expect(f.session.state.snapshot.value?.sequence).toBe(0);
      expect(f.session.mutationPending.value).toBe(true); expect(confirmed).toBe(false);
      f.push(2); expect(f.changes).toHaveBeenCalledTimes(1);
      await vi.runAllTimersAsync(); await pending;
      expect(installed).toEqual([1, 2]);
      expect(f.changes.mock.calls).toEqual([['doc', 0], ['doc', 1]]);
      expect(f.session.state.snapshot.value?.sequence).toBe(2);
      expect(f.session.mutationPending.value).toBe(false); expect(confirmed).toBe(true);
    } finally { stop(); vi.useRealTimers(); await f.session.close(); }
  });

  it('等待安装期间close与A→B→A使旧世代失效，旧结算不清掉新同步', async () => {
    const f = fixture(); await f.session.open('doc');
    const oldResponse = Promise.withResolvers<CanvasSynchronization>();
    f.changes.mockReturnValueOnce(oldResponse.promise);
    vi.useFakeTimers();
    try {
      const old = f.session.synchronize(1);
      oldResponse.resolve({ kind: 'snapshot', snapshot: snapshot('doc', 1) }); await oldResponse.promise;
      await f.session.close(); await f.session.open('b'); await f.session.open('doc');
      const currentResponse = Promise.withResolvers<CanvasSynchronization>();
      f.changes.mockReturnValueOnce(currentResponse.promise);
      const current = f.session.synchronize(2);
      await vi.runAllTimersAsync(); await old;
      expect(f.session.state.snapshot.value).toEqual(snapshot('doc'));
      expect(f.session.state.phase.value).toBe('ready');
      expect(f.session.synchronize(3)).toBe(current);
      currentResponse.resolve({ kind: 'snapshot', snapshot: snapshot('doc', 3) }); await currentResponse.promise;
      await vi.runAllTimersAsync(); await current;
      expect(f.session.state.snapshot.value).toEqual(snapshot('doc', 3));
      expect(f.changes).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); await f.session.close(); }
  });

  it('场景安装后同轮微任务收到更高序号，提交确认仍追平目标而不漏掉末次推送', async () => {
    const f = fixture(); await f.session.open('doc');
    const stop = watch(f.session.state.projection, value => {
      if (value?.snapshot.sequence === 1) queueMicrotask(() => f.push(2));
    }, { flush: 'sync' });
    try {
      await f.session.commit([{ op: 'addText', width: 280, height: 180, content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] } }]);
      expect(f.session.state.snapshot.value?.sequence).toBe(2);
      expect(f.changes.mock.calls).toEqual([['doc', 0], ['doc', 1]]);
    } finally { stop(); await f.session.close(); }
  });

  it('A→B→A 的旧异步响应不能装进新的文档会话', async () => {
    const f = fixture();
    const started = Promise.withResolvers<void>();
    let finishOld: ((value: CanvasSnapshot) => void) | undefined;
    f.read.mockImplementationOnce(async () => new Promise(resolve => { finishOld = resolve; started.resolve(); }));
    const old = f.session.open('a'); await started.promise;
    const latest = f.session.open('b');
    finishOld?.(snapshot('a', 10));
    await Promise.all([old, latest]);
    expect(f.session.state.snapshot.value?.documentId).toBe('b');
    expect(f.session.state.snapshot.value?.sequence).toBe(0);
    await f.session.close();
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
    expect(f.editing).toHaveBeenLastCalledWith(expect.objectContaining({ claims: [] }));
    expect(f.commit).not.toHaveBeenCalled(); await f.session.close();
  });
});
