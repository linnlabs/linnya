import type { CanvasCommitResult, CanvasGroupWriteOutcomes } from '../../../../shared';

/** 只投影正式字段回执；旧结果没有细节时标未知，不能拿原patch猜哪些字段被跳过。 */
export function projectCanvasSkippedFieldWrites(result: CanvasCommitResult): CanvasGroupWriteOutcomes {
  const skippedWrites: CanvasGroupWriteOutcomes['skippedWrites'] = [];
  let complete = true;
  for (const operation of result.results) {
    if (operation.fieldResults === undefined) {
      complete = false;
      if (operation.status === 'skipped') skippedWrites.push({ requestId: result.requestId, index: operation.index, id: operation.id, reason: operation.reason, fields: null });
      continue;
    }
    const reasons = new Map<string | null, string[]>();
    for (const field of operation.fieldResults) if (field.status === 'skipped') { const fields = reasons.get(field.reason) ?? []; fields.push(field.field); reasons.set(field.reason, fields); }
    for (const [reason, fields] of reasons) skippedWrites.push({ requestId: result.requestId, index: operation.index, id: operation.id, reason, fields });
  }
  return { complete, skippedWrites };
}
