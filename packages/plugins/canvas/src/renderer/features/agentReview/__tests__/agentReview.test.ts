import { describe, expect, it, vi } from 'vitest';
import { createCanvasDocumentSession } from '../../canvasDocument';
import { createCanvasAgentReview } from '..';
import type { CanvasAgentReviewPort } from '..';
import type { CanvasSnapshot, CanvasAgentGroup } from '@plugin/canvas/shared';

async function fixture() {
  const snapshot: CanvasSnapshot = { documentId: 'doc', sequence: 0, schemaVersion: 1, elements: [] };
  const session = createCanvasDocumentSession({ read: async () => snapshot, changes: async () => ({ kind: 'snapshot', snapshot: { ...snapshot, sequence: 2 } }),
    commit: async () => { throw new Error('unused'); }, editing: async () => {}, close: async () => {}, undo: vi.fn(async () => ({ commit: { documentId: 'doc', requestId: 'undo', sequence: 2, results: [], refs: {} }, canUndo: true, canRedo: false })), subscribe: () => () => {} });
  await session.open('doc');
  const groups = vi.fn(async (): Promise<CanvasAgentGroup[]> => []);
  const withdraw = vi.fn(async (input: Parameters<CanvasAgentReviewPort['withdraw']>[0]) => ({ commit: { documentId: 'doc', requestId: input.requestId, sequence: 2, results: [{ index: 0, status: 'applied' as const, id: null, reason: null }], refs: {} }, canUndo: true, canRedo: false }));
  const approve = vi.fn(async (): ReturnType<CanvasAgentReviewPort['approve']> => ({ kind: 'denied' }));
  const complete = vi.fn(async () => {}), review = vi.fn(async () => {});
  const runtime = createCanvasAgentReview(session, { groups, withdraw, approve, complete, review, subscribe: () => () => {} });
  return { runtime, session, groups, withdraw, approve, complete, review };
}
describe('Agent 改动审阅流程', () => {
  it('撤回只发本视图身份与组，接纳正式内容序号后刷新组', async () => {
    const f = await fixture();
    await f.runtime.withdraw('group');
    expect(f.withdraw).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'doc', viewId: f.session.viewId, groupId: 'group' }));
    expect(f.session.state.snapshot.value?.sequence).toBe(2);
    expect(f.groups).toHaveBeenCalledWith('doc', f.session.viewId);
    expect(f.runtime.state.busy.value).toBe(false);
    f.runtime.dispose(); await f.session.close();
  });
  it('逐卡撤回后重做只请求该次撤回的栈顶身份，后续用户操作不能被误撤', async () => {
    const f = await fixture();
    await f.runtime.withdraw('group', []);
    const summary = f.runtime.state.withdrawal.value;
    expect(summary?.canRedo).toBe(true);
    const undo = vi.spyOn(f.session, 'undo').mockRejectedValueOnce(new Error('canvas_history_head_changed'));
    await f.runtime.redoWithdrawal();
    expect(undo).toHaveBeenCalledWith('undo', { expectedActionId: summary?.actionId });
    expect(f.runtime.state.error.value).toContain('后续操作已改变撤销顺序');
    expect(f.runtime.state.withdrawal.value?.canRedo).toBe(true);
    f.runtime.dispose(); await f.session.close();
  });
  it('拒绝批次不改内容；失败保留组并明确报告', async () => {
    const f = await fixture();
    await f.runtime.approve('pending', 'deny');
    expect(f.session.state.snapshot.value?.sequence).toBe(0);
    f.complete.mockRejectedValueOnce(new Error('failed'));
    await f.runtime.complete('group');
    expect(f.runtime.state.error.value).toBe('failed');
    f.runtime.dispose(); await f.session.close();
  });
  it('卸载后迟到的查询不能重新装入组状态', async () => {
    const f = await fixture();
    let resolve: ((groups: CanvasAgentGroup[]) => void) | undefined;
    f.groups.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.runtime.refresh();
    f.runtime.dispose();
    resolve?.([]); await pending;
    expect(f.runtime.state.groups.value).toEqual([]);
    await f.session.close();
  });
});
