import {
  CanvasArrangeRequestSchema,
  type CanvasArrangeRequest,
  type CanvasCommand,
} from '@plugin/canvas/shared';
import {
  requireCanvasUserCommitApplied,
  requireWritableCanvas,
  type CanvasDocumentSession,
} from '../../canvasDocument';
import type { CanvasArrangementPort } from '../definitions/canvasLayoutCommands';
import { createCanvasLayoutState } from '../store/createCanvasLayoutState';
import { planCanvasTreeCreation } from '../functions/planCanvasTreeCreation';

export function createCanvasLayoutCommands(
  session: CanvasDocumentSession,
  port: CanvasArrangementPort
) {
  const state = createCanvasLayoutState();
  let active: {
      readonly documentId: string;
      readonly requestId: string;
      cancelled: boolean;
      started: boolean;
    } | null = null,
    disposed = false;
  let settled = Promise.resolve();
  const cancel = async () => {
    const job = active;
    if (job) {
      job.cancelled = true;
      await port.cancel({
        documentId: job.documentId,
        requestId: job.requestId,
        viewId: session.viewId,
      });
    }
  };
  return {
    state,
    cancel,
    flush: () => settled,
    planTree: (ids: Parameters<typeof planCanvasTreeCreation>[1], kind: 'child' | 'sibling') =>
      planCanvasTreeCreation(
        session.state.snapshot.value?.elements ?? [],
        ids,
        kind,
        state.direction.value
      ),
    async run(
      options: CanvasArrangeRequest['options'],
      operations: readonly CanvasCommand[] = [],
      historyGroupId?: string
    ) {
      if (disposed) throw new DOMException('Canvas layout disposed', 'AbortError');
      if (active) throw new Error('排布正在进行，请稍候或先取消');
      const { documentId } = requireWritableCanvas(session.state.snapshot.value);
      const job = { documentId, requestId: crypto.randomUUID(), cancelled: false, started: false };
      active = job;
      state.begin();
      let release!: () => void;
      settled = new Promise<void>(resolve => {
        release = resolve;
      });
      try {
        const request = CanvasArrangeRequestSchema.parse({
          documentId,
          viewId: session.viewId,
          requestId: job.requestId,
          options,
          operations: [...operations],
          ...(historyGroupId ? { historyGroupId } : {}),
        });
        const result = await session.confirmMutation({
          send: () => {
            if (job.cancelled && !job.started) throw new DOMException('排布已取消', 'AbortError');
            // 已投递的取消仍须确认原request；不能把“可能已提交”本地改判为未执行。
            job.started = true;
            return port.arrange(request);
          },
          accept: async result => {
            if (disposed || session.state.snapshot.value?.documentId !== documentId)
              throw new DOMException('Canvas layout view closed', 'AbortError');
            await session.synchronize(result.commit.sequence);
          },
        });
        state.complete(result.diagnostics);
        requireCanvasUserCommitApplied(result.commit);
        return result.commit;
      } catch (failure) {
        if (job.cancelled) throw new DOMException('排布已取消', 'AbortError');
        throw failure;
      } finally {
        if (active === job) {
          active = null;
          state.finish();
        }
        release();
      }
    },
    async dispose() {
      disposed = true;
      await cancel();
    },
  };
}
