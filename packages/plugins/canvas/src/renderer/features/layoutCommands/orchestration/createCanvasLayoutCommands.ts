import type { CanvasArrangeRequest, CanvasCommand } from '@plugin/canvas/shared';
import { requireCanvasUserCommitApplied, type CanvasDocumentSession } from '../../canvasDocument';
import type { CanvasArrangementPort } from '../definitions/canvasLayoutCommands';
import { createCanvasLayoutState } from '../store/createCanvasLayoutState';
import { planCanvasTreeCreation } from '../functions/planCanvasTreeCreation';

export function createCanvasLayoutCommands(session: CanvasDocumentSession, port: CanvasArrangementPort) {
  const state = createCanvasLayoutState();
  let active: { readonly documentId: string; readonly requestId: string; cancelled: boolean } | null = null, disposed = false;
  let settled = Promise.resolve();
  const cancel = async () => { const job = active; if (job) { job.cancelled = true; await port.cancel({ documentId: job.documentId, requestId: job.requestId, viewId: session.viewId }); } };
  return { state, cancel, flush: () => settled,
    planTree: (ids: Parameters<typeof planCanvasTreeCreation>[1], kind: 'child' | 'sibling') => planCanvasTreeCreation(session.state.snapshot.value?.elements ?? [], ids, kind, state.direction.value),
    async run(options: CanvasArrangeRequest['options'], operations: readonly CanvasCommand[] = [], historyGroupId?: string) {
      if (disposed) throw new DOMException('Canvas layout disposed', 'AbortError');
      if (active) throw new Error('排布正在进行，请稍候或先取消');
      const documentId = session.state.snapshot.value?.documentId; if (!documentId) throw new Error('画布尚未打开');
      const job = { documentId, requestId: crypto.randomUUID(), cancelled: false }; active = job; state.begin();
      let release!: () => void; settled = new Promise<void>(resolve => { release = resolve; });
      try {
        const result = await port.arrange({ documentId, viewId: session.viewId, requestId: job.requestId, options, operations: [...operations], ...(historyGroupId ? { historyGroupId } : {}) });
        if (disposed || session.state.snapshot.value?.documentId !== documentId) throw new DOMException('Canvas layout view closed', 'AbortError');
        await session.synchronize(result.commit.sequence); state.complete(result.diagnostics); requireCanvasUserCommitApplied(result.commit); return result.commit;
      } catch (failure) { if (job.cancelled) throw new DOMException('排布已取消', 'AbortError'); throw failure; }
      finally { if (active === job) { active = null; state.finish(); } release(); }
    },
    async dispose() { disposed = true; await cancel(); },
  };
}
