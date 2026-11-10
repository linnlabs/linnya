import type { CanvasAgentGroup, CanvasCommitResult, CanvasElement } from '@plugin/canvas/shared';
import type { CanvasWithdrawalSummary } from '../definitions/agentReview';
import { canvasText, projectCanvasFailureText } from '../../localization';
import { canvasReviewCardTitle, canvasReviewFields } from './projectCanvasReviewTargets';

const REASON_CODES = [
  'stale_field',
  'user_editing',
  'element_locked',
  'stale_layout_size',
  'stale_element',
  'element_missing',
  'later_fields_preserved',
  'later_use_preserved',
  'later_existence_preserved',
  'stale_measurement',
  'stale_geometry',
  'partial_fields_skipped',
  'dependent_field_changed',
  'history_dependency_unknown',
  'dependency_missing',
  'restored_nearby',
  'stale_revision',
] as const;
function isReasonCode(value: string): value is (typeof REASON_CODES)[number] {
  return REASON_CODES.some(code => code === value);
}
export function canvasReviewReason(reason: string | null): string {
  if (!reason) return canvasText('canvas.review.reason.none');
  return isReasonCode(reason)
    ? canvasText(`canvas.review.reason.${reason}`)
    : canvasText('canvas.review.reason.unknown');
}
/** 失败编号换成当前语言文案；请求层已换过的文字原样通过。 */
export function canvasReviewFailureMessage(error: unknown): string {
  return error instanceof Error ? projectCanvasFailureText(error.message) : String(error);
}
function titleOf(
  id: string | null,
  elements: readonly CanvasElement[],
  group: CanvasAgentGroup | undefined
): string {
  const element =
    elements.find(card => card.id === id) ?? group?.deletedCards.find(card => card.id === id);
  return element && element.type !== 'edge'
    ? canvasReviewCardTitle(element)
    : element?.type === 'edge'
      ? element.label || canvasText('canvas.review.object.connection')
      : canvasText('canvas.review.object.gone');
}
export function projectCanvasWithdrawalSummary(
  result: CanvasCommitResult,
  elements: readonly CanvasElement[],
  group?: CanvasAgentGroup
): CanvasWithdrawalSummary {
  const applied = result.results.filter(row => row.status === 'applied').length;
  const skipped = result.results.filter(row => row.status === 'skipped').length;
  const retained = result.results.reduce(
    (count, row) =>
      count +
      (row.fieldResults
        ? row.fieldResults.filter(field => field.status === 'skipped').length
        : row.reason?.startsWith('later_')
          ? 1
          : 0),
    0
  );
  const details = result.results.flatMap(row => {
    const fields = row.fieldResults?.filter(field => field.status === 'skipped');
    if (fields?.length)
      return fields.map(field =>
        canvasText('canvas.review.detailFields', {
          title: titleOf(row.id, elements, group),
          fields: canvasReviewFields([field.field]),
          reason: canvasReviewReason(field.reason),
        })
      );
    return row.reason !== null || row.status === 'skipped'
      ? [
          canvasText('canvas.review.detail', {
            title: titleOf(row.id, elements, group),
            reason: canvasReviewReason(row.reason),
          }),
        ]
      : [];
  });
  return {
    mode: 'withdraw',
    actionId: result.requestId,
    applied,
    skipped,
    retained,
    details,
    canRedo: applied > 0,
  };
}
export function projectCanvasSkippedWrites(
  group: CanvasAgentGroup,
  elements: readonly CanvasElement[]
): string[] {
  return group.outcomes.skippedWrites.map(row =>
    canvasText('canvas.review.detailFields', {
      title: titleOf(row.id, elements, group),
      fields: canvasReviewFields(row.fields),
      reason: canvasReviewReason(row.reason),
    })
  );
}
