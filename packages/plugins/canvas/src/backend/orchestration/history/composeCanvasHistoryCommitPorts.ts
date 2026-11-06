import type { CanvasCommitPorts } from '../../features/canvasCommit';
import { recordCanvasAgentCommit, reviewCanvasAgentElements } from '../../features/agentChanges';
import type { CanvasHistoryCommitPortsOptions } from '../definitions/canvasHistoryRuntime';
/** 保持事务内的开组/版本/审阅顺序；内存栈更新仍在提交之后执行。 */
export function composeCanvasHistoryCommitPorts(
  options: CanvasHistoryCommitPortsOptions
): CanvasCommitPorts {
  const { input, reservedRectangles, recordUserHistory } = options;

  return {
    ...options.outer,
    reservedRectangles,
    history(history) {
      input.beforeHistory?.(history);
      const groupStarted = recordCanvasAgentCommit(options.database, history);
      if (groupStarted)
        options.groupStarted?.({
          documentId: history.context.documentId,
          before: history.before,
          now: history.context.now,
        });
      const updateOuter = options.outer?.history?.(history);
      if (history.context.actor.source.kind === 'user')
        reviewCanvasAgentElements(options.database, {
          documentId: history.context.documentId,
          elementIds: history.plan.changes.map(change => change.id),
        });
      input.onCommit?.(history);
      const updateOwn = recordUserHistory(history, input.historyGroupId ?? null);
      return () => {
        updateOwn?.();
        updateOuter?.();
      };
    },
  };
}
