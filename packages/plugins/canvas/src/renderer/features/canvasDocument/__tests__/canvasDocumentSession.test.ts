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
  const port: CanvasDocumentPort = { read, changes, commit, editing, subscribe(callback) { push = callback; return unsubscribe; } };
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
});
