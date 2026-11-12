import {
  assignCanvasSections,
  CanvasRendererCommitRequestSchema,
  CanvasUndoRequestSchema,
  type CanvasCommand,
} from '@plugin/canvas/shared';
import type {
  CanvasDocumentMutationOptions,
  CanvasDocumentSession,
} from '../definitions/canvasDocumentSession';
import type { CanvasConfirmedMutation } from '../definitions/canvasMutation';
import { requireWritableCanvas } from '../functions/requireWritableCanvas';
import { requireCanvasUserCommitApplied } from '../functions/requireCanvasUserCommitApplied';
import { createCanvasMutationQueue } from './createCanvasMutationQueue';

/** 写意图确认独立于打开/关闭与增量追平；重试只重发原请求或接纳原回执。 */
export function createCanvasDocumentMutations(options: CanvasDocumentMutationOptions) {
  const { state, port, viewId, readSessionId, synchronize } = options;
  const mutations = createCanvasMutationQueue();
  const confirmMutation = <T>(operation: CanvasConfirmedMutation<T>): Promise<T> => {
    const token = readSessionId();
    let dispatched = false;
    requireWritableCanvas(state.snapshot.value);
    return mutations.execute({
      send: () => {
        if (token !== readSessionId())
          throw new DOMException('Canvas session closed', 'AbortError');
        // 重试是确认已经投递的请求；界面随后转只读不能把旧结果伪装成未执行。
        if (!dispatched) {
          requireWritableCanvas(state.snapshot.value);
          dispatched = true;
        }
        return operation.send();
      },
      accept: operation.accept,
    });
  };
  return {
    notice: mutations.state.notice,
    pending: mutations.state.pending,
    retryDelivery: mutations.retry,
    reset: mutations.reset,
    confirmMutation,
    commit(operations: readonly CanvasCommand[], historyGroupId?: string) {
      const token = readSessionId();
      const document = requireWritableCanvas(state.snapshot.value);
      const input = CanvasRendererCommitRequestSchema.parse({
        documentId: document.documentId,
        requestId: crypto.randomUUID(),
        viewId,
        // 界面里的放置按落点决定所在分区；Agent 经 CLI 显式指定，不走这里。
        operations: assignCanvasSections(document.elements, operations),
        ...(historyGroupId ? { historyGroupId } : {}),
      });
      return confirmMutation({
        send: () => port.commit(input),
        accept: async result => {
          if (token !== readSessionId())
            throw new DOMException('Canvas session closed', 'AbortError');
          await synchronize(result.sequence);
        },
      }).then(result => {
        requireCanvasUserCommitApplied(result);
        return result;
      });
    },
    undo(...[direction, undoOptions]: Parameters<CanvasDocumentSession['undo']>) {
      const token = readSessionId();
      const document = requireWritableCanvas(state.snapshot.value);
      const input = CanvasUndoRequestSchema.parse({
        documentId: document.documentId,
        viewId,
        requestId: crypto.randomUUID(),
        direction,
        ...undoOptions,
      });
      return confirmMutation({
        send: () => port.undo(input),
        accept: async result => {
          if (token !== readSessionId())
            throw new DOMException('Canvas session closed', 'AbortError');
          await synchronize(result.commit.sequence);
        },
      });
    },
  };
}
