import { CanvasRendererCommitRequestSchema, CanvasUndoRequestSchema, type CanvasCommand } from '@plugin/canvas/shared';
import type { CanvasDocumentPort, CanvasDocumentSession } from '../definitions/canvasDocumentSession';
import { createCanvasDocumentState } from '../store/createCanvasDocumentState';
import { applyCanvasSynchronization } from '../functions/applyCanvasSynchronization';
import { requireCanvasUserCommitApplied } from '../functions/requireCanvasUserCommitApplied';
import { requireWritableCanvas } from '../functions/requireWritableCanvas';
import { createCanvasMutationQueue } from './createCanvasMutationQueue';
import { createCanvasEditingClaims } from './createCanvasEditingClaims';
import type { CanvasConfirmedMutation } from '../definitions/canvasMutation';
import { readCanvasProjectionChanges } from '../functions/readCanvasProjectionChanges';
import { createCanvasViewRequests } from './createCanvasViewRequests';

/** 一个表面拥有一个会话；Host file handler 在关闭前先等待该表面的保存屏障。 */
export function createCanvasDocumentSession(port: CanvasDocumentPort): CanvasDocumentSession {
  const state = createCanvasDocumentState();
  const viewId = crypto.randomUUID();
  let sessionId = 0;
  let targetSequence = 0;
  let synchronization: Promise<void> | null = null;
  let unsubscribe: (() => void) | null = null;
  const mutations = createCanvasMutationQueue();
  const claims = createCanvasEditingClaims({ port, viewId, snapshot: () => state.snapshot.value, failed: error => state.fail(error instanceof Error ? error.message : String(error)) });
  const views = createCanvasViewRequests({ port, viewId, flushClaims: claims.flush });
  const requireDocument = () => {
    const current = state.snapshot.value;
    if (!current) throw new Error('Canvas document is not open');
    return current;
  };
  const confirmMutation = <T>(operation: CanvasConfirmedMutation<T>): Promise<T> => {
    const token = sessionId; let dispatched = false; requireWritableCanvas(state.snapshot.value);
    return mutations.execute({
      send: () => {
        if (token !== sessionId) throw new DOMException('Canvas session closed', 'AbortError');
        // 重试是确认已经投递的请求；界面随后转只读不能把旧结果伪装成未执行。
        if (!dispatched) { requireWritableCanvas(state.snapshot.value); dispatched = true; }
        return operation.send();
      },
      accept: operation.accept,
    });
  };
  const synchronize = (sequence: number): Promise<void> => {
    targetSequence = Math.max(targetSequence, sequence);
    if (synchronization) return synchronization;
    const token = sessionId;
    synchronization = (async () => {
      while (token === sessionId) {
        const current = requireDocument();
        if (current.sequence >= targetSequence) return;
        const update = await port.changes(current.documentId, current.sequence);
        // port已完成DTO校验；整代场景投影另起task，避免解码与同步Vue/kernel更新挤在同一长任务。
        // 短task自然结算，关闭只使世代失效；清掉timer反而会让旧同步的等待者永久挂起。
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (token !== sessionId) return;
        const installed = requireDocument();
        const next = applyCanvasSynchronization(installed, update);
        if (next.sequence <= installed.sequence) throw new Error('Canvas synchronization made no progress');
        state.install(next, readCanvasProjectionChanges(update));
      }
    })().then(() => {
      if (token !== sessionId) return;
      synchronization = null;
      // loop返回到Promise结算之间仍可能接到推送；交回通道前再追目标，不能漏掉最后一批。
      if (requireDocument().sequence < targetSequence) return synchronize(targetSequence);
    }, error => {
      if (token === sessionId) { synchronization = null; state.fail(error instanceof Error ? error.message : String(error)); }
      throw error;
    });
    return synchronization;
  };
  return {
    state, viewId, synchronize, deliveryNotice: mutations.state.notice, mutationPending: mutations.state.pending, retryDelivery: mutations.retry,
    confirmMutation,
    async open(documentId) {
      const token = ++sessionId;
      unsubscribe?.(); unsubscribe = null;
      synchronization = null; targetSequence = 0;
      claims.reset(); mutations.reset(); state.begin();
      try {
        // 先订阅再读快照，接住读取期间其他来源的提交；loading阶段只累计目标版本。
        unsubscribe = port.subscribe(event => {
          if (token !== sessionId || event.documentId !== documentId) return;
          targetSequence = Math.max(targetSequence, event.sequence);
          const current = state.snapshot.value;
          if (!current || event.sequence <= current.sequence) return;
          void synchronize(event.sequence).catch(() => { /* 状态已记录失败，界面提供明确重开入口。 */ });
        });
        const snapshot = await views.open(documentId, () => token === sessionId);
        if (token !== sessionId || !snapshot) return;
        state.install(snapshot);
        await synchronize(targetSequence);
      } catch (error) {
        if (token === sessionId) state.fail(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    commit(operations: readonly CanvasCommand[], historyGroupId?: string) {
      const token = sessionId;
      const document = requireWritableCanvas(state.snapshot.value);
      const input = CanvasRendererCommitRequestSchema.parse({ documentId: document.documentId, requestId: crypto.randomUUID(), viewId, operations, ...(historyGroupId ? { historyGroupId } : {}) });
      return confirmMutation({
        send: () => port.commit(input),
        accept: async result => { if (token !== sessionId) throw new DOMException('Canvas session closed', 'AbortError'); await synchronize(result.sequence); },
      }).then(result => { requireCanvasUserCommitApplied(result); return result; });
    },
    protect: claims.protect,
    undo(direction, options) {
      const token = sessionId;
      const document = requireWritableCanvas(state.snapshot.value);
      const input = CanvasUndoRequestSchema.parse({ documentId: document.documentId, viewId, requestId: crypto.randomUUID(), direction, ...options });
      return confirmMutation({
        send: () => port.undo(input),
        accept: async result => { if (token !== sessionId) throw new DOMException('Canvas session closed', 'AbortError'); await synchronize(result.commit.sequence); },
      });
    },
    async close() {
      sessionId += 1; unsubscribe?.(); unsubscribe = null;
      synchronization = null; targetSequence = 0; claims.reset(); mutations.reset(); state.clear();
      await views.close();
    },
  };
}
