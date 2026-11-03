import { CanvasCommitRequestSchema, CanvasUndoRequestSchema, type CanvasCommitResult, type CanvasUndoRequest, type CanvasUndoResult } from '../../../../shared';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import { commitCanvasOperations, commitCanvasTransition, type CanvasCommitActor, type CanvasCommitPorts } from '../../canvasCommit';
import type { CanvasHistoryEntry, CanvasUserHistoryScope } from '../definitions/canvasHistory';
import { captureCanvasHistory, mergeCanvasHistoryEntry } from '../functions/captureCanvasHistory';
import { planCanvasHistoryReversal } from '../functions/planCanvasHistoryReversal';

export function createCanvasHistoryRuntime(options: { readonly database: CanvasDatabase; readonly ports?: CanvasCommitPorts; readonly maxEntries?: number }) {
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
    options.database.prepare('DELETE FROM canvas_history_guards WHERE node_id = ? AND element_id NOT IN (SELECT value FROM json_each(?))').run(documentId, JSON.stringify(retained));
  }
  function commit(input: { readonly request: unknown; readonly actor: CanvasCommitActor; readonly now: number; readonly historyGroupId?: string }): CanvasCommitResult {
    const request = CanvasCommitRequestSchema.parse(input.request);
    const result = commitCanvasOperations({ database: options.database, ...input, ports: { ...options.ports, history(history) {
      const outer = options.ports?.history?.(history);
      if (input.actor.source.kind !== 'user' || !history.plan.changes.length) return outer;
      const entry = captureCanvasHistory(history.before, history.plan, input.historyGroupId ?? null);
      return () => {
        const value = scope(request.documentId, input.actor.viewId);
        const previous = value.undo[value.undo.length - 1];
        if (entry.groupId && previous?.groupId === entry.groupId) value.undo[value.undo.length - 1] = mergeCanvasHistoryEntry(previous, entry);
        else value.undo.push(entry);
        if (value.undo.length > maxEntries) value.undo.shift();
        value.redo = []; outer?.();
      };
    } } });
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
      payload: { kind: 'history', direction: request.direction }, ports: { ...options.ports, history: undefined },
      buildPlan(state, claims, origin) { const plan = planCanvasHistoryReversal({ state, claims, origin, actor, entry, now }); inverse = captureCanvasHistory(state, plan); return plan; },
    });
    if (inverse && from.length) { from.pop(); if (inverse.changes.length) to.push(inverse); }
    pruneGuards(request.documentId);
    return { commit: result, ...status(request.documentId, request.viewId) };
  }
  function releaseView(viewId: string) {
    const documents = new Set<string>();
    for (const [key, value] of scopes) if (value.viewId === viewId) { documents.add(value.documentId); scopes.delete(key); }
    for (const documentId of documents) pruneGuards(documentId);
  }
  return { commit, undo, status, releaseView };
}
