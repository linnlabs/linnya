import type { SlidesManualEditCommandOperation } from '@plugin/slides/shared/authoringEditing';

/** 页序动作和历史恢复呈现前，旧页索引不能接纳新插入。 */
export function ownsManualPageOrder(operation: SlidesManualEditCommandOperation): boolean {
  return 'index' in operation || operation.op === 'undo' || operation.op === 'redo';
}
