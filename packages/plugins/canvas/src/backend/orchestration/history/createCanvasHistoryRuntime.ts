import { previewCanvasHistoryCommit } from './previewCanvasHistoryCommit';
import type { CanvasHistoryPreviewInput } from '../definitions/canvasHistoryRuntime';
import { CanvasCommitRequestSchema, type CanvasCommitResult } from '../../../shared';
import {
  commitCanvasOperations,
  commitCanvasTransition,
  type CanvasCommitActor,
  type CanvasHistoryCommitInput,
  type CanvasTransitionInput,
} from '../../features/canvasCommit';
import { createCanvasUserHistoryState } from '../../features/canvasUndoHistory';
import { createCanvasGroupReview } from './createCanvasGroupReview';
import { createCanvasAgentApprovals } from './createCanvasAgentApprovals';
import { createCanvasHistoryRetention } from './createCanvasHistoryRetention';
import { createCanvasUserUndo } from './createCanvasUserUndo';
import { composeCanvasHistoryCommitPorts } from './composeCanvasHistoryCommitPorts';
import type {
  CanvasHistoryRuntimeOptions,
  CanvasHistoryPortsInput,
} from '../definitions/canvasHistoryRuntime';
export function createCanvasHistoryRuntime(options: CanvasHistoryRuntimeOptions) {
  function notifyGroups(documentId: string, reason: 'write' | 'review' | 'release') {
    try {
      options.groupsChanged?.(documentId, reason);
    } catch (error) {
      options.ports?.publicationFailed?.(error);
    }
  }
  const userState = createCanvasUserHistoryState();
  const { pruneGuards, registerView, reservedRectangles, releaseView, retainedElements } =
    createCanvasHistoryRetention({ ...options, userState, notifyGroups });
  const { status, recordUserHistory, undo } = createCanvasUserUndo({
    ...options,
    userState,
    pruneGuards,
  });
  const historyPorts = (input: CanvasHistoryPortsInput) =>
    composeCanvasHistoryCommitPorts({
      database: options.database,
      groupStarted: options.groupStarted,
      outer: options.ports,
      input,
      reservedRectangles,
      recordUserHistory,
    });

  const preview = (input: CanvasHistoryPreviewInput) =>
    previewCanvasHistoryCommit({ database: options.database, reservedRectangles }, input);

  function transition(
    input: Omit<CanvasTransitionInput, 'database' | 'ports'> & {
      readonly historyGroupId?: string;
      readonly onCommit?: (history: CanvasHistoryCommitInput) => void;
      readonly beforeHistory?: (history: CanvasHistoryCommitInput) => void;
    }
  ): CanvasCommitResult {
    if (input.actor.source.kind !== 'user') throw new Error('canvas_user_transition_required');
    const result = commitCanvasTransition({
      ...input,
      database: options.database,
      ports: historyPorts(input),
    });
    pruneGuards(input.documentId);
    return result;
  }
  function commit(input: {
    readonly request: unknown;
    readonly actor: CanvasCommitActor;
    readonly now: number;
    readonly historyGroupId?: string;
    readonly onCommit?: (history: CanvasHistoryCommitInput) => void;
    readonly beforeHistory?: (history: CanvasHistoryCommitInput) => void;
  }): CanvasCommitResult {
    const request = CanvasCommitRequestSchema.parse(input.request);
    const result = commitCanvasOperations({
      database: options.database,
      ...input,
      ports: historyPorts(input),
    });
    pruneGuards(request.documentId);
    return result;
  }

  const review = createCanvasGroupReview({
    ...options,
    status,
    pruneGuards,
    notifyGroups,
    recordUserHistory,
    viewBaseline: userState.viewBaseline,
  });
  const approvals = createCanvasAgentApprovals({
    database: options.database,
    commit,
    pruneGuards,
    onPending: options.pendingApproval,
    groupStarted: options.groupStarted,
  });
  // 重启丢弃内存用户栈；遗留删除身份由下一次实际操作/视图释放回收，读取不写数据库。
  return {
    registerView,
    preview,
    retainedElements,
    commit,
    transition,
    undo,
    status,
    releaseView,
    ...review,
    replayAgentRequest: approvals.replayAgentRequest,
    approvalResults: approvals.approvalResults,
    commitAgent(input: Parameters<typeof approvals.commitAgent>[0]) {
      const result = approvals.commitAgent(input);
      const request = CanvasCommitRequestSchema.parse(input.request);
      notifyGroups(request.documentId, 'write');
      return result;
    },
    resolveApproval(input: Parameters<typeof approvals.resolveApproval>[0], now: number) {
      const result = approvals.resolveApproval(input, now);
      notifyGroups(input.documentId, 'release');
      return result;
    },
  };
}
