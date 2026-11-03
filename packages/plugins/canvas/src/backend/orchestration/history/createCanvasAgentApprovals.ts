import { randomUUID } from 'node:crypto';
import { CanvasCommitRequestSchema, CanvasResolveApprovalRequestSchema, type CanvasAgentCommitResult, type CanvasApprovalResolution, type CanvasCommitResult, type CanvasResolveApprovalRequest } from '../../../shared';
import type { CanvasDatabase } from '../../definitions/canvasDatabase';
import { canvasPayloadHash, canvasSourceKey, planCanvasCommit, readCanvasCommitState, readCanvasEditingClaims, readCanvasReceipt, type CanvasCommitActor, type CanvasHistoryCommitInput } from '../../features/canvasCommit';
import { completeCanvasApproval, createCanvasAgentGroup, evaluateCanvasApproval, findCanvasAgentGroup, parseCanvasAgentReceiptResult, readCanvasAgentReceipt, readCanvasApprovalReceipt, readCanvasPendingApproval, saveCanvasAgentGroup, saveCanvasPendingApproval, clearCanvasPendingApproval, type CanvasPendingBatch } from '../../features/agentChanges';

export function createCanvasAgentApprovals(options: { readonly database: CanvasDatabase; readonly commit: (input: { request: unknown; actor: CanvasCommitActor; now: number; onCommit?: (input: CanvasHistoryCommitInput) => void }) => CanvasCommitResult; readonly pruneGuards: (documentId: string) => void }) {
  function commitAgent(input: { readonly request: unknown; readonly actor: CanvasCommitActor; readonly now: number; readonly intent?: 'apply' | 'arrange' }): CanvasAgentCommitResult {
    if (input.actor.source.kind !== 'agent') throw new Error('canvas_agent_source_required');
    const request = CanvasCommitRequestSchema.parse(input.request);
    const sourceKey = canvasSourceKey(input.actor); const payloadHash = canvasPayloadHash({ kind: 'operations', operations: request.operations });
    const result = options.database.transaction((): CanvasAgentCommitResult | { kind: 'ready' } => {
      const receipt = readCanvasAgentReceipt(options.database, request.documentId, sourceKey, request.requestId);
      if (receipt) {
        if (receipt.payload_hash !== payloadHash) throw new Error('request_id_payload_mismatch');
        if (receipt.status === 'committed' && receipt.result_json) return { kind: 'committed', commit: parseCanvasAgentReceiptResult(receipt.result_json) };
        const batch = receipt.status === 'pending' && receipt.pending_id ? readCanvasPendingApproval(options.database, request.documentId, receipt.pending_id) : null;
        if (batch) return { kind: 'pending', approval: batch.approval };
        throw new Error(`canvas_approval_${receipt.status}`);
      }
      // 普通提交的正式回执优先；重试不能再次通过大改门槛或改变归组。
      const prior = readCanvasReceipt(options.database, { documentId: request.documentId, sourceKey, requestId: request.requestId });
      if (prior) {
        if (prior.payloadHash !== payloadHash) throw new Error('request_id_payload_mismatch');
        return { kind: 'committed', commit: prior.result };
      }
      const state = readCanvasCommitState(options.database, request.documentId);
      const claims = readCanvasEditingClaims(options.database, { documentId: request.documentId, viewId: input.actor.viewId, now: input.now });
      const plan = planCanvasCommit({ state, operations: request.operations, actor: input.actor, now: input.now, claims, origin: `${sourceKey}:${request.requestId}` });
      const previous = findCanvasAgentGroup(options.database, request.documentId, sourceKey);
      const approval = evaluateCanvasApproval(state, plan, previous);
      if (!approval.reason) return { kind: 'ready' };
      const group = previous ?? createCanvasAgentGroup(request.documentId, input.actor.source.conversationId, input.now);
      saveCanvasAgentGroup(options.database, group);
      const batch: CanvasPendingBatch = { actor: input.actor, request, sourceKey, payloadHash, approval: {
        id: randomUUID(), groupId: group.id, requestId: request.requestId, reason: approval.reason,
        operationCount: request.operations.length, elementIds: [...new Set(plan.changes.map(change => change.id))], baseSequence: state.sequence,
        expectedRevisions: state.elements.filter(row => plan.changes.some(change => change.id === row.element.id)).map(row => ({ id: row.element.id, revision: row.element.revision })),
        deletedUserCardCount: approval.deletedUserCardCount, movedUserCardCount: approval.movedUserCardCount, createdAt: input.now,
      } };
      saveCanvasPendingApproval(options.database, batch);
      return { kind: 'pending', approval: batch.approval };
    }).immediate();
    if (result.kind === 'ready') return { kind: 'committed', commit: options.commit({ ...input, request }) };
    options.pruneGuards(request.documentId);
    return result;
  }
  /** 只由可信 Renderer 路由暴露；Agent 的 CLI 没有批准参数。 */
  function resolveApproval(value: CanvasResolveApprovalRequest, now: number): CanvasApprovalResolution {
    const request = CanvasResolveApprovalRequestSchema.parse(value);
    const batch = readCanvasPendingApproval(options.database, request.documentId, request.pendingId);
    if (!batch) {
      const receipt = readCanvasApprovalReceipt(options.database, request.documentId, request.pendingId);
      if (receipt?.status === 'committed' && receipt.result_json && request.decision === 'allow') return { kind: 'committed', commit: parseCanvasAgentReceiptResult(receipt.result_json) };
      if (receipt?.status === 'denied' && request.decision === 'deny') return { kind: 'denied' };
      throw new Error('canvas_approval_expired');
    }
    if (request.decision === 'deny') {
      options.database.transaction(() => clearCanvasPendingApproval(options.database, request.documentId, batch.approval.groupId, 'denied')).immediate();
      options.pruneGuards(request.documentId);
      return { kind: 'denied' };
    }
    const expected = new Map<string, number>(batch.approval.expectedRevisions.map(row => [row.id, row.revision]));
    // 确认期间改过的删除对象跳过；正文等字段仍由正式字段版本规则判断。
    const operations = batch.request.operations.map(operation => operation.op === 'delete' ? { ...operation, baseRevision: expected.get(operation.id) ?? operation.baseRevision } : operation);
    const commit = options.commit({ request: { ...batch.request, operations }, actor: batch.actor, now, onCommit(history) { completeCanvasApproval(options.database, batch, history.result); } });
    const result: CanvasApprovalResolution = { kind: 'committed', commit };
    options.pruneGuards(request.documentId);
    return result;
  }
  return { commitAgent, resolveApproval };
}
