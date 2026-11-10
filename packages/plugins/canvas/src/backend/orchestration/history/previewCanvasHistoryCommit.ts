import { CanvasCommitRequestSchema } from '../../../shared';
import {
  readCanvasCommitState,
  readCanvasEditingClaims,
  planCanvasCommit,
  validateCanvasPlanContent,
} from '../../features/canvasCommit';
import type {
  CanvasHistoryRuntimeOptions,
  CanvasHistoryCommitPortsOptions,
  CanvasHistoryPreviewInput,
} from '../definitions/canvasHistoryRuntime';
/** 预演读取最新状态与保护，但不建立历史或提交元素。 */
export function previewCanvasHistoryCommit(
  options: Pick<CanvasHistoryRuntimeOptions, 'database'> & {
    reservedRectangles: CanvasHistoryCommitPortsOptions['reservedRectangles'];
  },
  input: CanvasHistoryPreviewInput
) {
  const request = CanvasCommitRequestSchema.parse(input.request);
  const state = readCanvasCommitState(options.database, request.documentId);
  const claims = readCanvasEditingClaims(options.database, {
    documentId: request.documentId,
    viewId: input.actor.viewId,
    now: input.now,
  });
  const plan = planCanvasCommit({
    state,
    claims,
    actor: input.actor,
    now: input.now,
    operations: request.operations,
    layoutGroups: request.layoutGroups,
    origin: 'preview',
    reservedRectangles: options.reservedRectangles(state, {
      documentId: request.documentId,
      requestId: request.requestId,
      actor: input.actor,
      now: input.now,
    }),
  });
  validateCanvasPlanContent(plan);
  return plan;
}
