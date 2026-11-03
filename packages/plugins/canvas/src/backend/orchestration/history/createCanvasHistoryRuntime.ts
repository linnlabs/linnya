import { CanvasCommitRequestSchema, CanvasUndoRequestSchema, type CanvasCommitResult, type CanvasUndoRequest, type CanvasUndoResult } from '../../../shared';
import type { CanvasDatabase } from '../../definitions/canvasDatabase';
import { commitCanvasOperations, commitCanvasTransition, planCanvasCommit, validateCanvasPlanContent, readCanvasCommitState, readCanvasEditingClaims, readCanvasSequence, type CanvasCommitActor, type CanvasCommitPorts, type CanvasHistoryCommitInput, type CanvasTransitionInput } from '../../features/canvasCommit';
import type { CanvasHistoryEntry, CanvasUserHistoryScope } from '../../shared/history/definitions/canvasHistory';
import { canvasDeletionReservations, readCanvasAgentGroups, recordCanvasAgentCommit, reviewCanvasAgentElement } from '../../features/agentChanges';
import { createCanvasGroupReview } from './createCanvasGroupReview';
import { createCanvasAgentApprovals } from './createCanvasAgentApprovals';
import { z } from 'zod';
import { captureCanvasHistory, mergeCanvasHistoryEntry } from '../../shared/history/functions/captureCanvasHistory';
import { planCanvasHistoryReversal } from '../../shared/history/functions/planCanvasHistoryReversal';

export function createCanvasHistoryRuntime(options: { readonly database: CanvasDatabase; readonly ports?: CanvasCommitPorts; readonly maxEntries?: number; readonly groupsChanged?: (documentId: string) => void; readonly pendingApproval?: (batch: import('../../features/agentChanges').CanvasPendingBatch) => void }) {
  function notifyGroups(documentId: string) {
    try { options.groupsChanged?.(documentId); } catch (error) { options.ports?.publicationFailed?.(error); }
  }
  const viewBaselines = new Map<string, { documentId: string; viewId: string; sequence: number }>();
  const scopes = new Map<string, CanvasUserHistoryScope>();
  const maxEntries = options.maxEntries ?? 100;
  function scope(documentId: string, viewId: string) {
    const key = JSON.stringify([documentId, viewId]);
    let value = scopes.get(key);
    if (!value) { value = { documentId, viewId, undo: [], redo: [] }; scopes.set(key, value); }
    return value;
  }
  function status(documentId: string, viewId: string) { const value = scope(documentId, viewId); return { canUndo: value.undo.length > 0, canRedo: value.redo.length > 0 }; }
  function pruneGuards(documentId: string) {
    const retained = [...scopes.values()].filter(value => value.documentId === documentId).flatMap(value => [...value.undo, ...value.redo].flatMap(entry => entry.changes.map(change => change.id)));
    for (const group of readCanvasAgentGroups(options.database, documentId)) retained.push(...group.entry.changes.map(change => change.id));
    options.database.prepare('DELETE FROM canvas_history_guards WHERE node_id = ? AND element_id NOT IN (SELECT value FROM json_each(?))').run(documentId, JSON.stringify(retained));
  }
  function registerView(input: { readonly documentId: string; readonly viewId: string }) {
    const key = JSON.stringify([input.documentId, input.viewId]);
    if (!viewBaselines.has(key)) viewBaselines.set(key, { ...input, sequence: readCanvasSequence(options.database, input.documentId) });
  }
  function reservedRectangles(state: import('../../features/canvasCommit').CanvasCommitState, context: import('../../features/canvasCommit').CanvasCommitContext) {
    const baselines = [...viewBaselines.values()].filter(view => view.documentId === context.documentId).map(view => view.sequence);
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
    const entry = captureCanvasHistory(history.before, history.plan, groupId);
    return () => {
      const value = scope(history.context.documentId, history.context.actor.viewId);
      const previous = value.undo[value.undo.length - 1];
      if (entry.groupId && previous?.groupId === entry.groupId) value.undo[value.undo.length - 1] = mergeCanvasHistoryEntry(previous, entry);
      else value.undo.push(entry);
      if (value.undo.length > maxEntries) value.undo.shift();
      value.redo = [];
    };
  }
  function historyPorts(input: { readonly historyGroupId?: string; readonly onCommit?: (history: CanvasHistoryCommitInput) => void }): CanvasCommitPorts {
    return { ...options.ports, reservedRectangles, history(history) {
      const updateOuter = options.ports?.history?.(history);
      recordCanvasAgentCommit(options.database, history);
      if (history.context.actor.source.kind === 'user') for (const change of history.plan.changes) reviewCanvasAgentElement(options.database, { documentId: history.context.documentId, elementId: change.id });
      input.onCommit?.(history);
      const updateOwn = recordUserHistory(history, input.historyGroupId ?? null);
      return () => { updateOwn?.(); updateOuter?.(); };
    } };
  }
  function transition(input: Omit<CanvasTransitionInput, 'database' | 'ports'> & { readonly historyGroupId?: string; readonly onCommit?: (history: CanvasHistoryCommitInput) => void }): CanvasCommitResult {
    if (input.actor.source.kind !== 'user') throw new Error('canvas_user_transition_required');
    const result = commitCanvasTransition({ ...input, database: options.database, ports: historyPorts(input) });
    pruneGuards(input.documentId); return result;
  }
  function commit(input: { readonly request: unknown; readonly actor: CanvasCommitActor; readonly now: number; readonly historyGroupId?: string; readonly onCommit?: (history: CanvasHistoryCommitInput) => void }): CanvasCommitResult {
    const request = CanvasCommitRequestSchema.parse(input.request);
    const result = commitCanvasOperations({ database: options.database, ...input, ports: historyPorts(input) });
    pruneGuards(request.documentId);
    return result;
  }
  function undo(value: CanvasUndoRequest, now: number): CanvasUndoResult {
    const request = CanvasUndoRequestSchema.parse(value);
    const current = scope(request.documentId, request.viewId);
    const from = request.direction === 'undo' ? current.undo : current.redo;
    const to = request.direction === 'undo' ? current.redo : current.undo;
    const entry = from[from.length - 1] ?? { changes: [], groupId: null };
    let inverse: CanvasHistoryEntry | undefined;
    const actor: CanvasCommitActor = { source: { kind: 'user', conversationId: null, runId: null }, viewId: request.viewId };
    const result = commitCanvasTransition({ database: options.database, documentId: request.documentId, requestId: request.requestId, actor, now,
      payload: { kind: 'history', direction: request.direction }, ports: options.ports,
      buildPlan(state, claims, origin) { const plan = planCanvasHistoryReversal({ state, claims, origin, actor, entry, now }); inverse = captureCanvasHistory(state, plan); return plan; },
    });
    if (inverse && from.length) { from.pop(); if (inverse.changes.length) to.push(inverse); }
    pruneGuards(request.documentId);
    return { commit: result, ...status(request.documentId, request.viewId) };
  }
  function releaseView(viewId: string) {
    for (const [key, view] of viewBaselines) if (view.viewId === viewId) viewBaselines.delete(key);
    const documents = new Set<string>();
    for (const [key, value] of scopes) if (value.viewId === viewId) { documents.add(value.documentId); scopes.delete(key); }
    for (const documentId of documents) pruneGuards(documentId);
  }
  function retainedElements(documentId: string) {
    const entries = [...scopes.values()].filter(value => value.documentId === documentId).flatMap(value => [...value.undo, ...value.redo]).concat(readCanvasAgentGroups(options.database, documentId).map(group => group.entry));
    return entries.flatMap(entry => entry.changes.flatMap(change => [change.before, change.after].flatMap(element => element ? [element] : [])));
  }
  const review = createCanvasGroupReview({ ...options, status, pruneGuards, notifyGroups, recordUserHistory, viewBaseline: (documentId, viewId) => viewBaselines.get(JSON.stringify([documentId, viewId]))?.sequence });
  const approvals = createCanvasAgentApprovals({ database: options.database, commit, pruneGuards, onPending: options.pendingApproval });
  // 用户栈不跨进程保留。重启只清理已经没有持有者的删除身份，组记录仍可继续撤回。
  for (const raw of options.database.prepare('SELECT DISTINCT node_id FROM canvas_history_guards').all()) pruneGuards(z.object({ node_id: z.string() }).parse(raw).node_id);
  return { registerView, preview, retainedElements, commit, transition, undo, status, releaseView, ...review, replayAgentRequest: approvals.replayAgentRequest, approvalResults: approvals.approvalResults,
    commitAgent(input: Parameters<typeof approvals.commitAgent>[0]) { const result = approvals.commitAgent(input); const request = CanvasCommitRequestSchema.parse(input.request); notifyGroups(request.documentId); return result; },
    resolveApproval(input: Parameters<typeof approvals.resolveApproval>[0], now: number) { const result = approvals.resolveApproval(input, now); notifyGroups(input.documentId); return result; },
  };
}
