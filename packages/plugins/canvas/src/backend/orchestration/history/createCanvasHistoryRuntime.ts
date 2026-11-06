import { CanvasCommitRequestSchema, CanvasUndoRequestSchema, type CanvasCommitResult, type CanvasUndoRequest, type CanvasUndoResult } from '../../../shared';
import type { CanvasDatabase } from '../../definitions/canvasDatabase';
import { commitCanvasOperations, commitCanvasTransition, planCanvasCommit, validateCanvasPlanContent, readCanvasCommitState, readCanvasEditingClaims, readCanvasSequence, type CanvasCommitActor, type CanvasCommitPorts, type CanvasHistoryCommitInput, type CanvasTransitionInput } from '../../features/canvasCommit';
import type { CanvasHistoryEntry } from '../../shared/history/definitions/canvasHistory';
import { canvasDeletionReservations, readCanvasAgentGroups, recordCanvasAgentCommit, reviewCanvasAgentElements, type CanvasAgentGroupStart } from '../../features/agentChanges';
import { createCanvasGroupReview } from './createCanvasGroupReview';
import { createCanvasAgentApprovals } from './createCanvasAgentApprovals';
import { captureCanvasHistory } from '../../shared/history/functions/captureCanvasHistory';
import { createCanvasUserHistoryState, appendCanvasUserHistory, traverseCanvasUserHistory } from '../../features/canvasUndoHistory';
import { planCanvasHistoryReversal } from '../../shared/history/functions/planCanvasHistoryReversal';
import { releaseCanvasEditingClaims, pruneCanvasHistoryGuards } from '../../features/canvasCommit';

export function createCanvasHistoryRuntime(options: { readonly database: CanvasDatabase; readonly ports?: CanvasCommitPorts; readonly maxEntries?: number; readonly groupsChanged?: (documentId: string, reason: 'write' | 'review' | 'release') => void; readonly groupStarted?: (input: CanvasAgentGroupStart) => void; readonly pendingApproval?: (batch: import('../../features/agentChanges').CanvasPendingBatch) => void }) {
  function notifyGroups(documentId: string, reason: 'write' | 'review' | 'release') {
    try { options.groupsChanged?.(documentId, reason); } catch (error) { options.ports?.publicationFailed?.(error); }
  }
  const userState = createCanvasUserHistoryState();
  const maxEntries = options.maxEntries ?? 100;
  function status(documentId: string, viewId: string) { const value = userState.read(documentId, viewId); return { canUndo: value.undo.length > 0, canRedo: value.redo.length > 0 }; }
  function pruneGuards(documentId: string) {
    const retained = userState.list(documentId).flatMap(value => [...value.undo, ...value.redo].flatMap(entry => entry.changes.map(change => change.id)));
    for (const group of readCanvasAgentGroups(options.database, documentId)) retained.push(...group.entry.changes.map(change => change.id));
    pruneCanvasHistoryGuards(options.database, { documentId, retainedIds: retained });
  }
  function registerView(input: { readonly documentId: string; readonly viewId: string }) {
    userState.registerView({ ...input, sequence: readCanvasSequence(options.database, input.documentId) });
  }
  function reservedRectangles(state: import('../../features/canvasCommit').CanvasCommitState, context: import('../../features/canvasCommit').CanvasCommitContext) {
    const baselines = userState.baselines(context.documentId);
    return [...canvasDeletionReservations(readCanvasAgentGroups(options.database, context.documentId), state, baselines.length ? Math.min(...baselines) : undefined), ...(options.ports?.reservedRectangles?.(state, context) ?? [])];
  }
  function preview(input: { readonly request: unknown; readonly actor: CanvasCommitActor; readonly now: number }) {
    const request = CanvasCommitRequestSchema.parse(input.request);
    const state = readCanvasCommitState(options.database, request.documentId);
    const claims = readCanvasEditingClaims(options.database, { documentId: request.documentId, viewId: input.actor.viewId, now: input.now });
    const plan = planCanvasCommit({ state, claims, actor: input.actor, now: input.now, operations: request.operations, layoutGroups: request.layoutGroups, origin: 'preview', reservedRectangles: reservedRectangles(state, { documentId: request.documentId, requestId: request.requestId, actor: input.actor, now: input.now }) });
    validateCanvasPlanContent(plan); return plan;
  }
  function recordUserHistory(history: CanvasHistoryCommitInput, groupId: string | null = null) {
    if (history.context.actor.source.kind !== 'user' || !history.plan.changes.length) return undefined;
    const entry = { ...captureCanvasHistory(history.before, history.plan, groupId), actionId: history.context.requestId };
    return () => {
      const value = userState.read(history.context.documentId, history.context.actor.viewId);
      userState.install(appendCanvasUserHistory(value, entry, maxEntries));
    };
  }
  function historyPorts(input: { readonly historyGroupId?: string; readonly onCommit?: (history: CanvasHistoryCommitInput) => void; readonly beforeHistory?: (history: CanvasHistoryCommitInput) => void }): CanvasCommitPorts {
    return { ...options.ports, reservedRectangles, history(history) {
      input.beforeHistory?.(history);
      const groupStarted = recordCanvasAgentCommit(options.database, history);
      if (groupStarted) options.groupStarted?.({ documentId: history.context.documentId, before: history.before, now: history.context.now });
      const updateOuter = options.ports?.history?.(history);
      if (history.context.actor.source.kind === 'user') reviewCanvasAgentElements(options.database, {
        documentId: history.context.documentId, elementIds: history.plan.changes.map(change => change.id),
      });
      input.onCommit?.(history);
      const updateOwn = recordUserHistory(history, input.historyGroupId ?? null);
      return () => { updateOwn?.(); updateOuter?.(); };
    } };
  }
  function transition(input: Omit<CanvasTransitionInput, 'database' | 'ports'> & { readonly historyGroupId?: string; readonly onCommit?: (history: CanvasHistoryCommitInput) => void; readonly beforeHistory?: (history: CanvasHistoryCommitInput) => void }): CanvasCommitResult {
    if (input.actor.source.kind !== 'user') throw new Error('canvas_user_transition_required');
    const result = commitCanvasTransition({ ...input, database: options.database, ports: historyPorts(input) });
    pruneGuards(input.documentId); return result;
  }
  function commit(input: { readonly request: unknown; readonly actor: CanvasCommitActor; readonly now: number; readonly historyGroupId?: string; readonly onCommit?: (history: CanvasHistoryCommitInput) => void; readonly beforeHistory?: (history: CanvasHistoryCommitInput) => void }): CanvasCommitResult {
    const request = CanvasCommitRequestSchema.parse(input.request);
    const result = commitCanvasOperations({ database: options.database, ...input, ports: historyPorts(input) });
    pruneGuards(request.documentId);
    return result;
  }
  function undo(value: CanvasUndoRequest, now: number): CanvasUndoResult {
    const request = CanvasUndoRequestSchema.parse(value);
    const current = userState.read(request.documentId, request.viewId);
    const from = request.direction === 'undo' ? current.undo : current.redo;
    const entry = from[from.length - 1] ?? { changes: [], groupId: null };
    let inverse: CanvasHistoryEntry | undefined;
    const actor: CanvasCommitActor = { source: { kind: 'user', conversationId: null, runId: null }, viewId: request.viewId };
    const result = commitCanvasTransition({ database: options.database, documentId: request.documentId, requestId: request.requestId, actor, now,
      payload: { kind: 'history', direction: request.direction, expectedActionId: request.expectedActionId ?? null }, ports: options.ports,
      buildPlan(state, claims, origin) {
        // 回执重放先于此检查；新操作只能反转用户实际指向的栈顶，不能凭内容/序号猜。
        if (request.expectedActionId !== undefined && entry.actionId !== request.expectedActionId) throw new Error('canvas_history_head_changed');
        const plan = planCanvasHistoryReversal({ state, claims, origin, actor, entry, now });
        inverse = { ...captureCanvasHistory(state, plan), actionId: request.requestId }; return plan;
      },
    });
    if (inverse) userState.install(traverseCanvasUserHistory({ scope: current, direction: request.direction, inverse }));
    pruneGuards(request.documentId);
    return { commit: result, ...status(request.documentId, request.viewId) };
  }
  function releaseView(viewId: string) {
    releaseCanvasEditingClaims(options.database, viewId);
    for (const documentId of userState.releaseView(viewId)) { pruneGuards(documentId); notifyGroups(documentId, 'release'); }
  }
  function retainedElements(documentId: string) {
    const entries = userState.list(documentId).flatMap(value => [...value.undo, ...value.redo]).concat(readCanvasAgentGroups(options.database, documentId).map(group => group.entry));
    return entries.flatMap(entry => entry.changes.flatMap(change => [change.before, change.after].flatMap(element => element ? [element] : [])));
  }
  const review = createCanvasGroupReview({ ...options, status, pruneGuards, notifyGroups, recordUserHistory, viewBaseline: userState.viewBaseline });
  const approvals = createCanvasAgentApprovals({ database: options.database, commit, pruneGuards, onPending: options.pendingApproval, groupStarted: options.groupStarted });
  // 重启丢弃内存用户栈；遗留删除身份由下一次实际操作/视图释放回收，读取不写数据库。
  return { registerView, preview, retainedElements, commit, transition, undo, status, releaseView, ...review, replayAgentRequest: approvals.replayAgentRequest, approvalResults: approvals.approvalResults,
    commitAgent(input: Parameters<typeof approvals.commitAgent>[0]) { const result = approvals.commitAgent(input); const request = CanvasCommitRequestSchema.parse(input.request); notifyGroups(request.documentId, 'write'); return result; },
    resolveApproval(input: Parameters<typeof approvals.resolveApproval>[0], now: number) { const result = approvals.resolveApproval(input, now); notifyGroups(input.documentId, 'release'); return result; },
  };
}
