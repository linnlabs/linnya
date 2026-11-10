import {
  CanvasUndoRequestSchema,
  type CanvasUndoRequest,
  type CanvasUndoResult,
} from '../../../shared';
import {
  commitCanvasTransition,
  type CanvasCommitActor,
  type CanvasHistoryCommitInput,
} from '../../features/canvasCommit';
import type { CanvasHistoryEntry } from '../../shared/history/definitions/canvasHistory';
import { captureCanvasHistory, planCanvasHistoryReversal } from '../../shared/history';
import {
  appendCanvasUserHistory,
  traverseCanvasUserHistory,
} from '../../features/canvasUndoHistory';
import type { CanvasUserUndoOptions } from '../definitions/canvasHistoryRuntime';
/** 用户栈的记录与遍历共用同一state；Agent改动不进入这里。 */
export function createCanvasUserUndo(options: CanvasUserUndoOptions) {
  const { userState, pruneGuards } = options;
  const maxEntries = options.maxEntries ?? 100;
  function status(documentId: string, viewId: string) {
    const value = userState.read(documentId, viewId);
    return { canUndo: value.undo.length > 0, canRedo: value.redo.length > 0 };
  }
  function recordUserHistory(history: CanvasHistoryCommitInput, groupId: string | null = null) {
    if (history.context.actor.source.kind !== 'user' || !history.plan.changes.length)
      return undefined;
    const entry = {
      ...captureCanvasHistory(history.before, history.plan, groupId),
      actionId: history.context.requestId,
    };
    return () => {
      const value = userState.read(history.context.documentId, history.context.actor.viewId);
      userState.install(appendCanvasUserHistory(value, entry, maxEntries));
    };
  }
  function undo(value: CanvasUndoRequest, now: number): CanvasUndoResult {
    const request = CanvasUndoRequestSchema.parse(value);
    const current = userState.read(request.documentId, request.viewId);
    const from = request.direction === 'undo' ? current.undo : current.redo;
    const entry = from[from.length - 1] ?? { changes: [], groupId: null };
    let inverse: CanvasHistoryEntry | undefined;
    const actor: CanvasCommitActor = {
      source: { kind: 'user', conversationId: null, runId: null },
      viewId: request.viewId,
    };
    const result = commitCanvasTransition({
      database: options.database,
      documentId: request.documentId,
      requestId: request.requestId,
      actor,
      now,
      payload: {
        kind: 'history',
        direction: request.direction,
        expectedActionId: request.expectedActionId ?? null,
      },
      ports: options.ports,
      buildPlan(state, claims, origin) {
        // 回执重放先于此检查；新操作只能反转用户实际指向的栈顶，不能凭内容/序号猜。
        if (request.expectedActionId !== undefined && entry.actionId !== request.expectedActionId)
          throw new Error('canvas_history_head_changed');
        const plan = planCanvasHistoryReversal({ state, claims, origin, actor, entry, now });
        inverse = { ...captureCanvasHistory(state, plan), actionId: request.requestId };
        return plan;
      },
    });
    if (inverse)
      userState.install(
        traverseCanvasUserHistory({ scope: current, direction: request.direction, inverse })
      );
    pruneGuards(request.documentId);
    return { commit: result, ...status(request.documentId, request.viewId) };
  }
  return { status, recordUserHistory, undo };
}
