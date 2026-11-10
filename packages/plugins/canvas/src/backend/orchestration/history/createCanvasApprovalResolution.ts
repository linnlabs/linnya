import {
  CanvasResolveApprovalRequestSchema,
  type CanvasResolveApprovalRequest,
  type CanvasApprovalResolution,
} from '../../../shared';
import {
  readCanvasPendingApproval,
  readCanvasApprovalReceipt,
  clearCanvasPendingApproval,
  completeCanvasApproval,
} from '../../features/agentChanges';
import type { CanvasAgentApprovalOptions } from '../definitions/canvasAgentApprovals';
/** 批准/拒绝只对可信Renderer公开，重试先读原审批回执。 */
export function createCanvasApprovalResolution(options: CanvasAgentApprovalOptions) {
  function resolveApproval(
    value: CanvasResolveApprovalRequest,
    now: number
  ): CanvasApprovalResolution {
    const request = CanvasResolveApprovalRequestSchema.parse(value);
    const batch = readCanvasPendingApproval(
      options.database,
      request.documentId,
      request.pendingId
    );
    if (!batch) {
      const receipt = readCanvasApprovalReceipt(
        options.database,
        request.documentId,
        request.pendingId
      );
      if (receipt?.status === 'committed' && receipt.commit && request.decision === 'allow')
        return { kind: 'committed', commit: receipt.commit };
      if (receipt?.status === 'denied' && request.decision === 'deny') return { kind: 'denied' };
      throw new Error('canvas_approval_expired');
    }
    if (request.decision === 'deny') {
      options.database
        .transaction(() =>
          clearCanvasPendingApproval(
            options.database,
            request.documentId,
            batch.approval.groupId,
            'denied'
          )
        )
        .immediate();
      options.pruneGuards(request.documentId);
      return { kind: 'denied' };
    }
    const expected = new Map<string, number>(
      batch.approval.expectedRevisions.map(row => [row.id, row.revision])
    );
    // 确认期间改过的删除对象跳过；正文等字段仍由正式字段版本规则判断。
    const operations = batch.request.operations.map(operation =>
      operation.op === 'delete'
        ? { ...operation, baseRevision: expected.get(operation.id) ?? operation.baseRevision }
        : operation
    );
    const commit = options.commit({
      request: { ...batch.request, operations },
      actor: batch.actor,
      now,
      onCommit() {
        completeCanvasApproval(options.database, batch);
      },
    });
    const result: CanvasApprovalResolution = { kind: 'committed', commit };
    options.pruneGuards(request.documentId);
    return result;
  }
  return resolveApproval;
}
