import { watch } from 'vue';
import type { CanvasElementId } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import type { CanvasAgentReviewOptions, CanvasAgentReviewPort } from '../definitions/agentReview';
import { chooseCanvasReviewGroup } from '../functions/projectCanvasReviewTargets';
import { projectCanvasWithdrawalSummary } from '../functions/projectCanvasReviewOutcome';
import { createCanvasAgentReviewState } from '../store/createCanvasAgentReviewState';

export function createCanvasAgentReview(session: CanvasDocumentSession, port: CanvasAgentReviewPort, options: CanvasAgentReviewOptions = {}) {
  const state = createCanvasAgentReviewState();
  let generation = 0, disposed = false;
  const documentId = () => { const id = session.state.snapshot.value?.documentId; if (!id) throw new Error('画布尚未打开'); return id; };
  const fail = (error: unknown) => state.fail(error instanceof Error && error.message === 'canvas_history_head_changed' ? '后续操作已改变撤销顺序，请使用画布撤销逐步处理。' : error instanceof Error ? error.message : String(error));
  async function refresh() {
    if (disposed || !session.state.snapshot.value) return;
    const token = ++generation, id = documentId();
    const groups = await port.groups(id, session.viewId);
    if (!disposed && token === generation && id === session.state.snapshot.value?.documentId) state.install(groups, chooseCanvasReviewGroup(state.groups.value, groups, state.activeGroupId.value));
  }
  const run = async (action: () => Promise<void>, preparesContent = false) => {
    if (state.busy.value || disposed) return;
    state.start();
    try {
      if (preparesContent && options.beforeMutation && !(await options.beforeMutation())) { state.fail('当前草稿尚未保存，操作未执行。'); return; }
      if (disposed) { state.finish(); return; }
      await action(); await refresh(); state.finish();
    } catch (error) { fail(error); }
  };
  const stop = watch(session.state.snapshot, snapshot => { if (snapshot) void refresh().catch(fail); });
  const unsubscribe = port.subscribe(session.state.snapshot.value?.documentId ?? '', () => { void refresh().catch(fail); });
  // writing 是时间派生值；静默结束不能依赖有下一次内容写入来刷新。
  const timer = setInterval(() => { if (state.groups.value.some(group => group.writing)) void refresh().catch(fail); }, 2000);
  return { state, refresh,
    select: state.select,
    focus: state.focus,
    withdraw: (groupId: string, elementIds?: readonly CanvasElementId[]) => run(async () => {
      const request = { documentId: documentId(), viewId: session.viewId, requestId: crypto.randomUUID(), groupId, ...(elementIds !== undefined ? { elementIds: [...elementIds] } : {}) };
      const elements = session.state.snapshot.value?.elements ?? [];
      const group = state.groups.value.find(value => value.id === groupId);
      const result = await session.confirmMutation({ send: () => port.withdraw(request), accept: result => session.synchronize(result.commit.sequence) });
      state.withdrawn(projectCanvasWithdrawalSummary(result.commit, elements, group));
    }, true),
    redoWithdrawal: () => {
      const withdrawal = state.withdrawal.value;
      if (!withdrawal?.canRedo) return Promise.resolve();
      return run(async () => {
        const result = await session.undo('undo', { expectedActionId: withdrawal.actionId });
        state.redone();
        if (result.commit.results.some(row => row.status === 'skipped' || row.reason !== null)) state.withdrawn({ ...projectCanvasWithdrawalSummary(result.commit, session.state.snapshot.value?.elements ?? []), mode: 'redo', canRedo: false });
      }, true);
    },
    approve: (pendingId: string, decision: 'allow' | 'deny') => run(async () => {
      const request = { documentId: documentId(), viewId: session.viewId, requestId: crypto.randomUUID(), pendingId, decision };
      await session.confirmMutation({ send: () => port.approve(request), accept: async result => { if (result.kind === 'committed') await session.synchronize(result.commit.sequence); } });
    }, decision === 'allow'),
    complete: (groupId: string) => run(async () => { await port.complete(documentId(), groupId); }),
    review: (elementId: CanvasElementId, groupId?: string) => run(async () => { await port.review(documentId(), elementId, groupId); }),
    dispose() { disposed = true; generation += 1; clearInterval(timer); stop(); unsubscribe(); },
  };
}
