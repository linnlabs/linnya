import { mergeCanvasHistoryEntry, type CanvasHistoryEntry } from '../../../shared/history';
import type { CanvasUserHistoryScope } from '../definitions/canvasUserHistoryState';

/** 连续编辑合一步；新的用户意图会清空重做栈，容量只限制用户会话。 */
export function appendCanvasUserHistory(
  scope: CanvasUserHistoryScope,
  entry: CanvasHistoryEntry,
  maxEntries: number
): CanvasUserHistoryScope {
  const undo = [...scope.undo];
  const previous = undo[undo.length - 1];
  if (entry.groupId && previous?.groupId === entry.groupId)
    undo[undo.length - 1] = mergeCanvasHistoryEntry(previous, entry);
  else undo.push(entry);
  return { ...scope, undo: undo.slice(Math.max(0, undo.length - maxEntries)), redo: [] };
}

/** 重做只持有本次实际反转的子集，不能越过后来被其他来源修改的字段。 */
export function traverseCanvasUserHistory(input: {
  readonly scope: CanvasUserHistoryScope;
  readonly direction: 'undo' | 'redo';
  readonly inverse: CanvasHistoryEntry;
}): CanvasUserHistoryScope {
  const from = input.direction === 'undo' ? input.scope.undo : input.scope.redo;
  if (!from.length) return input.scope;
  const to = input.direction === 'undo' ? input.scope.redo : input.scope.undo;
  const destination = input.inverse.changes.length ? [...to, input.inverse] : to;
  return input.direction === 'undo'
    ? { ...input.scope, undo: from.slice(0, -1), redo: destination }
    : { ...input.scope, redo: from.slice(0, -1), undo: destination };
}
