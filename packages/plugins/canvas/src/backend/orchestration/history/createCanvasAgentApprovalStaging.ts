import { randomUUID } from 'node:crypto';
import type { JsonValue } from '@app/schemas';
import type { CanvasCommitRequest, CanvasAgentCommitResult } from '../../../shared';
import {
  canvasPayloadHash,
  canvasSourceKey,
  readCanvasCommitState,
  readCanvasEditingClaims,
  planCanvasCommit,
  validateCanvasPlanContent,
} from '../../features/canvasCommit';
import {
  findCanvasAgentGroup,
  evaluateCanvasApproval,
  createCanvasAgentGroup,
  saveCanvasAgentGroup,
  saveCanvasPendingApproval,
  type CanvasPendingBatch,
} from '../../features/agentChanges';
import type {
  CanvasAgentApprovalOptions,
  CanvasAgentWriteInput,
  CanvasAgentRequestReplay,
} from '../definitions/canvasAgentApprovals';
/** 预演与创建待确认批次共享事务；未越阈值只返回ready，正式提交仍重新验证。 */
export function createCanvasAgentApprovalStaging(
  options: CanvasAgentApprovalOptions,
  replayAgentRequest: CanvasAgentRequestReplay
) {
  return (
    input: CanvasAgentWriteInput,
    request: CanvasCommitRequest & { payloadIdentity: JsonValue }
  ) => {
    const { payloadIdentity } = request;
    const sourceKey = canvasSourceKey(input.actor),
      payloadHash = canvasPayloadHash(payloadIdentity);
    return options.database
      .transaction((): CanvasAgentCommitResult | { kind: 'ready' } => {
        const replay = replayAgentRequest({
          documentId: request.documentId,
          requestId: request.requestId,
          actor: input.actor,
          payloadIdentity,
        });
        if (replay) return replay;
        const state = readCanvasCommitState(options.database, request.documentId);
        const claims = readCanvasEditingClaims(options.database, {
          documentId: request.documentId,
          viewId: input.actor.viewId,
          now: input.now,
        });
        const plan = planCanvasCommit({
          state,
          operations: request.operations,
          layoutGroups: request.layoutGroups,
          actor: input.actor,
          now: input.now,
          claims,
          origin: `${sourceKey}:${request.requestId}`,
        });
        validateCanvasPlanContent(plan);
        const previous = findCanvasAgentGroup(options.database, request.documentId, sourceKey);
        const approval = evaluateCanvasApproval(state, plan, previous);
        if (!approval.reason) return { kind: 'ready' };
        const group =
          previous ??
          createCanvasAgentGroup(request.documentId, input.actor.source.conversationId, input.now);
        saveCanvasAgentGroup(options.database, group);
        if (!previous)
          options.groupStarted?.({ documentId: request.documentId, before: state, now: input.now });
        const changed = new Set(plan.changes.map(change => change.id));
        const expectedRevisions = state.elements
          .filter(row => changed.has(row.element.id))
          .map(row => ({ id: row.element.id, revision: row.element.revision }));
        const batch: CanvasPendingBatch = {
          actor: input.actor,
          request,
          sourceKey,
          payloadHash,
          approval: {
            id: randomUUID(),
            groupId: group.id,
            requestId: request.requestId,
            reason: approval.reason,
            // 尚未分配的新卡ID只是预测，不能把后来同号的别人的卡当作待确认目标高亮。
            operationCount: request.operations.length,
            elementIds: expectedRevisions.map(row => row.id),
            baseSequence: state.sequence,
            expectedRevisions,
            deletedUserCardCount: approval.deletedUserCardCount,
            movedUserCardCount: approval.movedUserCardCount,
            createdAt: input.now,
          },
        };
        saveCanvasPendingApproval(options.database, batch);
        options.onPending?.(batch);
        return { kind: 'pending', approval: batch.approval };
      })
      .immediate();
  };
}
