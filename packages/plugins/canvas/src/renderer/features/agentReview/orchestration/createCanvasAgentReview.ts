import { watch } from 'vue';
import type { CanvasElementId } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import type { CanvasAgentReviewPort } from '../definitions/agentReview';
import { createCanvasAgentReviewState } from '../store/createCanvasAgentReviewState';

export function createCanvasAgentReview(session: CanvasDocumentSession, port: CanvasAgentReviewPort) {
  const state = createCanvasAgentReviewState();
  let generation = 0, disposed = false;
  const documentId = () => { const id = session.state.snapshot.value?.documentId; if (!id) throw new Error('画布尚未打开'); return id; };
  const fail = (error: unknown) => state.fail(error instanceof Error ? error.message : String(error));
  async function refresh() {
    if (disposed || !session.state.snapshot.value) return;
    const token = ++generation, id = documentId();
    const groups = await port.groups(id, session.viewId);
    if (!disposed && token === generation && id === session.state.snapshot.value?.documentId) state.install(groups);
  }
  const run = async (action: () => Promise<void>) => {
    state.start();
    try { await action(); await refresh(); state.finish(); } catch (error) { fail(error); }
  };
  const stop = watch(session.state.snapshot, snapshot => { if (snapshot) void refresh().catch(fail); });
  const unsubscribe = port.subscribe(session.state.snapshot.value?.documentId ?? '', () => { void refresh().catch(fail); });
  // writing 是时间派生值；静默结束不能依赖有下一次内容写入来刷新。
  const timer = setInterval(() => { if (state.groups.value.some(group => group.writing)) void refresh().catch(fail); }, 2000);
  return { state, refresh,
    select: state.select,
    withdraw: (groupId: string, elementIds?: readonly CanvasElementId[]) => run(async () => {
      const request = { documentId: documentId(), viewId: session.viewId, requestId: crypto.randomUUID(), groupId, ...(elementIds?.length ? { elementIds: [...elementIds] } : {}) };
      await session.confirmMutation({ send: () => port.withdraw(request), accept: result => session.synchronize(result.commit.sequence) });
    }),
    approve: (pendingId: string, decision: 'allow' | 'deny') => run(async () => {
      const request = { documentId: documentId(), viewId: session.viewId, requestId: crypto.randomUUID(), pendingId, decision };
      await session.confirmMutation({ send: () => port.approve(request), accept: async result => { if (result.kind === 'committed') await session.synchronize(result.commit.sequence); } });
    }),
    complete: (groupId: string) => run(async () => { await port.complete(documentId(), groupId); }),
    review: (elementId: CanvasElementId, groupId?: string) => run(async () => { await port.review(documentId(), elementId, groupId); }),
    dispose() { disposed = true; generation += 1; clearInterval(timer); stop(); unsubscribe(); },
  };
}
