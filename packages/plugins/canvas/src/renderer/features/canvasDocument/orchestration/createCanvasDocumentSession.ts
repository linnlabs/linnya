import { createCanvasDocumentSynchronization } from './createCanvasDocumentSynchronization';
import type {
  CanvasDocumentPort,
  CanvasDocumentSession,
} from '../definitions/canvasDocumentSession';
import { createCanvasDocumentState } from '../store/createCanvasDocumentState';
import { createCanvasDocumentMutations } from './createCanvasDocumentMutations';
import { createCanvasEditingClaims } from './createCanvasEditingClaims';
import { createCanvasViewRequests } from './createCanvasViewRequests';

/** 一个表面拥有一个会话；Host file handler 在关闭前先等待该表面的保存屏障。 */
export function createCanvasDocumentSession(port: CanvasDocumentPort): CanvasDocumentSession {
  const state = createCanvasDocumentState();
  const viewId = crypto.randomUUID();
  let sessionId = 0;
  let unsubscribe: (() => void) | null = null;
  const claims = createCanvasEditingClaims({
    port,
    viewId,
    snapshot: () => state.snapshot.value,
    failed: error => state.fail(error instanceof Error ? error.message : String(error)),
  });
  const views = createCanvasViewRequests({ port, viewId, flushClaims: claims.flush });
  const synchronization = createCanvasDocumentSynchronization({
    port,
    state,
    readSessionId: () => sessionId,
  });
  const synchronize = synchronization.synchronize;
  const mutations = createCanvasDocumentMutations({
    port,
    state,
    viewId,
    readSessionId: () => sessionId,
    synchronize,
  });
  return {
    state,
    viewId,
    synchronize,
    deliveryNotice: mutations.notice,
    mutationPending: mutations.pending,
    retryDelivery: mutations.retryDelivery,
    confirmMutation: mutations.confirmMutation,
    async open(documentId) {
      const token = ++sessionId;
      unsubscribe?.();
      unsubscribe = null;
      synchronization.reset();
      claims.reset();
      mutations.reset();
      state.begin();
      try {
        // 先订阅再读快照，接住读取期间其他来源的提交；loading阶段只累计目标版本。
        unsubscribe = port.subscribe(event => {
          if (token !== sessionId || event.documentId !== documentId) return;
          synchronization.observe(event.sequence);
        });
        const snapshot = await views.open(documentId, () => token === sessionId);
        if (token !== sessionId || !snapshot) return;
        state.install(snapshot);
        await synchronization.catchUp();
      } catch (error) {
        if (token === sessionId) state.fail(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    commit: mutations.commit,
    undo: mutations.undo,
    protect: claims.protect,
    async close() {
      sessionId += 1;
      unsubscribe?.();
      unsubscribe = null;
      synchronization.reset();
      claims.reset();
      mutations.reset();
      state.clear();
      await views.close();
    },
  };
}
