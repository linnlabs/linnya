import { canvasDeletionReservations, readCanvasAgentGroups } from '../../features/agentChanges';
import {
  pruneCanvasHistoryGuards,
  readCanvasSequence,
  releaseCanvasEditingClaims,
} from '../../features/canvasCommit';
import type { CanvasHistoryRetentionOptions } from '../definitions/canvasHistoryRuntime';
/** 视图基线、删除占位和guard可达性属于同一持有者生命周期。 */
export function createCanvasHistoryRetention(options: CanvasHistoryRetentionOptions) {
  const { userState, notifyGroups } = options;
  function pruneGuards(documentId: string) {
    const retained = userState
      .list(documentId)
      .flatMap(value =>
        [...value.undo, ...value.redo].flatMap(entry => entry.changes.map(change => change.id))
      );
    for (const group of readCanvasAgentGroups(options.database, documentId))
      retained.push(...group.entry.changes.map(change => change.id));
    pruneCanvasHistoryGuards(options.database, { documentId, retainedIds: retained });
  }
  function registerView(input: { readonly documentId: string; readonly viewId: string }) {
    userState.registerView({
      ...input,
      sequence: readCanvasSequence(options.database, input.documentId),
    });
  }
  function reservedRectangles(
    state: import('../../features/canvasCommit').CanvasCommitState,
    context: import('../../features/canvasCommit').CanvasCommitContext
  ) {
    const baselines = userState.baselines(context.documentId);
    return [
      ...canvasDeletionReservations(
        readCanvasAgentGroups(options.database, context.documentId),
        state,
        baselines.length ? Math.min(...baselines) : undefined
      ),
      ...(options.ports?.reservedRectangles?.(state, context) ?? []),
    ];
  }
  function releaseView(viewId: string) {
    releaseCanvasEditingClaims(options.database, viewId);
    for (const documentId of userState.releaseView(viewId)) {
      pruneGuards(documentId);
      notifyGroups(documentId, 'release');
    }
  }
  function retainedElements(documentId: string) {
    const entries = userState
      .list(documentId)
      .flatMap(value => [...value.undo, ...value.redo])
      .concat(readCanvasAgentGroups(options.database, documentId).map(group => group.entry));
    return entries.flatMap(entry =>
      entry.changes.flatMap(change =>
        [change.before, change.after].flatMap(element => (element ? [element] : []))
      )
    );
  }
  return { pruneGuards, registerView, reservedRectangles, releaseView, retainedElements };
}
