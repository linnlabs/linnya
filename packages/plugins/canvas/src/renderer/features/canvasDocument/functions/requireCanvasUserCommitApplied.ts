import type { CanvasCommitResult } from '@plugin/canvas/shared';
import { canvasText } from '../../localization';
export class CanvasCommitOutcomeError extends Error {
  constructor(
    message: string,
    readonly result: CanvasCommitResult
  ) {
    super(message);
  }
}
/** 用户相对操作和显式排布共用准确结果说明；已成功内容须先由调用方同步。 */
export function requireCanvasUserCommitApplied(result: CanvasCommitResult): void {
  const skipped = result.results.filter(
    outcome =>
      outcome.status === 'skipped' ||
      outcome.fieldResults?.some(field => field.status === 'skipped')
  );
  if (!skipped.length) return;
  const applied = result.results.filter(outcome => outcome.status === 'applied').length,
    changed = canvasText('canvas.error.contentChanged');
  throw new CanvasCommitOutcomeError(
    `${applied ? canvasText('canvas.error.commitPartial', { applied, skipped: skipped.length }) : canvasText('canvas.error.commitNone')}: ${[...new Set(skipped.flatMap(outcome => (outcome.fieldResults ? outcome.fieldResults.filter(field => field.status === 'skipped').map(field => `${field.field}: ${field.reason ?? changed}`) : [outcome.reason ?? changed])))].join(canvasText('canvas.list.separator'))}`,
    result
  );
}
