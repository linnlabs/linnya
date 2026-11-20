import {
  CanvasWithdrawGroupRequestSchema,
  type CanvasElementId,
  type CanvasWithdrawGroupRequest,
  type CanvasUndoResult,
} from '../../../shared';
import type { CanvasDatabase } from '../../definitions/canvasDatabase';
import {
  commitCanvasTransition,
  type CanvasCommitActor,
  type CanvasCommitPorts,
  type CanvasHistoryCommitInput,
} from '../../features/canvasCommit';
import {
  clearCanvasPendingApproval,
  deleteCanvasAgentGroup,
  findCanvasPendingApproval,
  projectCanvasAgentGroup,
  readCanvasAgentGroup,
  readCanvasAgentGroups,
  reviewCanvasAgentElement,
  saveCanvasAgentGroup,
  selectCanvasGroupWithdrawal,
} from '../../features/agentChanges';
import { planCanvasHistoryReversal, splitCanvasHistoryWithdrawal } from '../../shared/history';

export function createCanvasGroupReview(options: {
  readonly database: CanvasDatabase;
  readonly ports?: CanvasCommitPorts;
  readonly recordUserHistory: (input: CanvasHistoryCommitInput) => (() => void) | undefined;
  readonly status: (documentId: string, viewId: string) => { canUndo: boolean; canRedo: boolean };
  readonly pruneGuards: (documentId: string) => void;
  readonly notifyGroups: (documentId: string, reason: 'review' | 'release') => void;
  readonly viewBaseline: (documentId: string, viewId: string) => number | undefined;
}) {
  function listGroups(documentId: string, now: number, viewId?: string) {
    return readCanvasAgentGroups(options.database, documentId).map(group =>
      projectCanvasAgentGroup(
        group,
        findCanvasPendingApproval(options.database, documentId, group.id)?.approval ?? null,
        now,
        viewId ? options.viewBaseline(documentId, viewId) : undefined
      )
    );
  }
  function withdraw(value: CanvasWithdrawGroupRequest, now: number): CanvasUndoResult {
    const request = CanvasWithdrawGroupRequestSchema.parse(value);
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
        kind: 'withdrawGroup',
        groupId: request.groupId,
        elementIds: request.elementIds ?? null,
      },
      buildPlan(state, claims, origin) {
        const group = readCanvasAgentGroup(options.database, request.documentId, request.groupId);
        if (!group) throw new Error('canvas_group_missing');
        const selection = selectCanvasGroupWithdrawal(group.entry, request.elementIds);
        return planCanvasHistoryReversal({
          state,
          claims,
          origin,
          actor,
          entry: selection.selected,
          now,
        });
      },
      ports: {
        ...options.ports,
        history(history) {
          const group = readCanvasAgentGroup(options.database, request.documentId, request.groupId);
          if (!group) throw new Error('canvas_group_missing');
          const selection = selectCanvasGroupWithdrawal(group.entry, request.elementIds);
          // 暂时跳过（用户正在编辑、卡片锁定）的改动留在组里，角标保留，之后可再撤回。
          const split = splitCanvasHistoryWithdrawal(selection.selected, history.plan.results);
          const remaining = new Set(selection.remaining.changes);
          clearCanvasPendingApproval(
            options.database,
            request.documentId,
            request.groupId,
            'withdrawn'
          );
          saveCanvasAgentGroup(options.database, {
            ...group,
            entry: {
              ...selection.remaining,
              changes: group.entry.changes.flatMap(change => {
                if (remaining.has(change)) return [change];
                const deferred = split.deferred.get(change);
                return deferred ? [deferred] : [];
              }),
            },
            deletedUserCardIds: group.deletedUserCardIds.filter(id => !split.restoredIds.has(id)),
          });
          const updateOwn = options.recordUserHistory(history);
          const updateOuter = options.ports?.history?.(history);
          return () => {
            updateOwn?.();
            updateOuter?.();
          };
        },
      },
    });
    options.pruneGuards(request.documentId);
    options.notifyGroups(request.documentId, 'release');
    return { commit: result, ...options.status(request.documentId, request.viewId) };
  }
  function closeGroup(input: { readonly documentId: string; readonly groupId: string }) {
    options.database
      .transaction(() => deleteCanvasAgentGroup(options.database, input.documentId, input.groupId))
      .immediate();
    options.pruneGuards(input.documentId);
    options.notifyGroups(input.documentId, 'release');
  }
  function reviewElement(input: {
    readonly documentId: string;
    readonly elementId: CanvasElementId;
    readonly groupId?: string;
  }) {
    options.database
      .transaction(() => reviewCanvasAgentElement(options.database, input))
      .immediate();
    options.notifyGroups(input.documentId, 'review');
  }
  return { listGroups, withdraw, closeGroup, reviewElement };
}
