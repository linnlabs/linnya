import { MANUAL_EDIT_HISTORY_LIMIT, type ManualEditHistoryFocus, type ManualEditHistoryState } from '../definitions/manualEditHistory.js';
import type { SlidesManualEditHistoryFocus, SlidesManualEditHistoryStatus } from '@plugin/slides/shared/authoringEditing';

export function reconcileManualEditHistory(state: ManualEditHistoryState | undefined, currentRevisionId: string): ManualEditHistoryState {
  return state?.currentRevisionId === currentRevisionId ? state : { currentRevisionId, undo: [], redo: [] };
}
export function manualEditHistoryStatus(state: ManualEditHistoryState): SlidesManualEditHistoryStatus {
  return { revisionId: state.currentRevisionId, undoDepth: state.undo.length, redoDepth: state.redo.length };
}
export function manualEditHistoryTarget(state: ManualEditHistoryState, action: 'undo' | 'redo'): string | undefined {
  return action === 'undo' ? state.undo[state.undo.length - 1]?.before : state.redo[state.redo.length - 1]?.after;
}
/** 撤销回到编辑前的页，重做回到编辑后的页。 */
export function manualEditHistoryFocus(state: ManualEditHistoryState, action: 'undo' | 'redo'): SlidesManualEditHistoryFocus | undefined {
  const focus = action === 'undo' ? state.undo[state.undo.length - 1]?.focus : state.redo[state.redo.length - 1]?.focus;
  return focus && { slideIndex: action === 'undo' ? focus.beforeSlideIndex : focus.afterSlideIndex, targets: focus.targets };
}
export function advanceManualEditHistory(
  state: ManualEditHistoryState,
  revisionId: string,
  action: 'edit' | 'undo' | 'redo',
  focus?: ManualEditHistoryFocus,
): ManualEditHistoryState {
  if (action === 'edit') return { currentRevisionId: revisionId,
    undo: [...state.undo, { before: state.currentRevisionId, after: revisionId, ...(focus ? { focus } : {}) }].slice(-MANUAL_EDIT_HISTORY_LIMIT), redo: [] };
  const entries = action === 'undo' ? state.undo : state.redo;
  const entry = entries[entries.length - 1];
  if (!entry) throw new Error('Cannot advance empty editing history');
  return action === 'undo'
    ? { currentRevisionId: revisionId, undo: state.undo.slice(0, -1), redo: [...state.redo, entry] }
    : { currentRevisionId: revisionId, undo: [...state.undo, entry], redo: state.redo.slice(0, -1) };
}
export function retainedManualEditHistoryVersions(state: ManualEditHistoryState | undefined, currentRevisionId: string): readonly string[] {
  if (state?.currentRevisionId !== currentRevisionId) return [];
  return [...new Set([...state.undo, ...state.redo].flatMap(entry => [entry.before, entry.after]))];
}
