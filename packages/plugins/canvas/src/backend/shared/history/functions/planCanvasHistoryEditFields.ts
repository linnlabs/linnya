import type { CanvasOperationFieldResult } from '../../../../shared';
import {
  readCanvasUpdateFieldUnits,
  type CanvasStoredElement,
} from '../../../features/canvasCommit';
import type { CanvasHistoryEdit } from '../definitions/canvasHistoryReversal';

function sourceReason(
  record: CanvasHistoryEdit,
  current: CanvasStoredElement,
  field: string,
  claimed: ReadonlySet<string>
): string | null {
  if (claimed.has(field)) return 'user_editing';
  if (
    record.beforeOrigins[field] === undefined ||
    record.afterOrigins[field] === undefined ||
    current.fieldOrigins[field] === undefined
  )
    return 'history_dependency_unknown';
  return current.fieldOrigins[field] === record.afterOrigins[field]
    ? null
    : 'later_fields_preserved';
}
/** 历史只恢复来源未变且语义仍完整的子集，不通过重测/改写别人的高度来凑旧正文。 */
export function planCanvasHistoryEditFields(
  record: CanvasHistoryEdit,
  current: CanvasStoredElement,
  claimedFields: readonly string[]
): CanvasOperationFieldResult[] {
  const claimed = new Set(claimedFields),
    reasons = new Map<string, string | null>();
  for (const field of record.fields)
    reasons.set(field, sourceReason(record, current, field, claimed));
  const units = readCanvasUpdateFieldUnits({
    before: record.before,
    after: record.after,
    fields: record.fields,
  });
  for (const unit of units) {
    const dependencies = [...new Set([...unit.fields, ...unit.dependencies])];
    const conflicts = dependencies
      .map(field => sourceReason(record, current, field, claimed))
      .filter(reason => reason !== null);
    if (!conflicts.length) continue;
    const dependent = conflicts.includes('history_dependency_unknown')
      ? 'history_dependency_unknown'
      : 'dependent_field_changed';
    // 独立字段沿用直接冲突原因；语义组中原本可恢复的字段才注明依赖变化。
    for (const field of unit.fields)
      if (!reasons.get(field) && (unit.fields.length > 1 || unit.dependencies.length))
        reasons.set(field, dependent);
  }
  return record.fields.map(field => {
    const reason = reasons.get(field) ?? null;
    return { field, status: reason ? 'skipped' : 'applied', reason };
  });
}
export function canvasHistoryFieldResultReason(
  fields: readonly CanvasOperationFieldResult[]
): string | null {
  const skipped = fields.filter(field => field.status === 'skipped');
  if (!skipped.length) return null;
  if (skipped.some(field => field.reason === 'history_dependency_unknown'))
    return 'history_dependency_unknown';
  if (skipped.some(field => field.reason === 'dependent_field_changed'))
    return 'dependent_field_changed';
  return 'later_fields_preserved';
}
