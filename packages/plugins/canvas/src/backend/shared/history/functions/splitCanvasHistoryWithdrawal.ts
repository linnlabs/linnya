import type { CanvasElementId } from '../../../../shared';
import type { CanvasCommitPlan } from '../../../features/canvasCommit';
import type { CanvasHistoryChange, CanvasHistoryEntry } from '../definitions/canvasHistory';
import { orderCanvasHistoryReversal } from './planCanvasHistoryReversal';

/** 只有这两种跳过是暂时的：结束编辑或解锁后仍可再撤回，其余原因都是永久保留当前图。 */
const TEMPORARY_REASONS: ReadonlySet<string> = new Set(['user_editing', 'element_locked']);

function deferredFields(result: CanvasCommitPlan['results'][number]): readonly string[] {
  const skipped = (result.fieldResults ?? []).filter(field => field.status === 'skipped');
  const temporary = skipped.filter(field => field.reason && TEMPORARY_REASONS.has(field.reason));
  if (!temporary.length) return [];
  // 同一语义组里因暂时字段受阻而一起跳过的依赖字段也留下；下次撤回会按当时状态重新判断。
  return [...temporary, ...skipped.filter(field => field.reason === 'dependent_field_changed')].map(
    field => field.field
  );
}

/**
 * 撤回结果拆回组记录：暂时跳过的记录（或其中暂时跳过的字段）留在组里，其余移出；
 * 同时给出实际已恢复的被删卡片。
 */
export function splitCanvasHistoryWithdrawal(
  entry: Pick<CanvasHistoryEntry, 'changes'>,
  results: CanvasCommitPlan['results']
) {
  const deferred = new Map<CanvasHistoryChange, CanvasHistoryChange>();
  const restoredIds = new Set<CanvasElementId>();
  orderCanvasHistoryReversal(entry).forEach((record, index) => {
    const result = results[index];
    if (!result || result.id !== record.id) throw new Error('canvas_withdrawal_result_mismatch');
    if (result.status === 'applied' && record.before && !record.after) restoredIds.add(record.id);
    if (result.fieldResults?.length) {
      const fields = deferredFields(result);
      if (fields.length) deferred.set(record, { ...record, fields: [...fields] });
    } else if (result.status === 'skipped' && result.reason && TEMPORARY_REASONS.has(result.reason))
      deferred.set(record, record);
  });
  return { deferred, restoredIds };
}
