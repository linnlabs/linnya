import { createHash } from 'node:crypto';
import { CanvasCommitRequestSchema, CanvasCommitResultSchema, type CanvasCommitResult } from '../../../../shared/changeset/definitions/canvasCommands';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import type { CanvasCommitActor, CanvasCommitParticipant, CanvasCommitPlan } from '../definitions/canvasCommit';
import { planCanvasCommit } from '../functions/planCanvasCommit';
import { persistCanvasCommit, readCanvasCommitState, readCanvasEditingClaims, readCanvasReceipt } from '../persistence/canvasRepository';

export interface CanvasCommitPorts {
  readonly participants?: readonly CanvasCommitParticipant[];
  readonly publish?: (plan: CanvasCommitPlan) => void;
  readonly publicationFailed?: (error: unknown) => void;
}

/** 所有当前内容写入共用此路径；异步排版必须在进入此函数前完成。 */
export function commitCanvasOperations(input: {
  readonly database: CanvasDatabase; readonly request: unknown; readonly actor: CanvasCommitActor;
  readonly now: number; readonly ports?: CanvasCommitPorts;
}): CanvasCommitResult {
  const request = CanvasCommitRequestSchema.parse(input.request);
  const sourceKey = JSON.stringify([input.actor.source.kind, input.actor.source.conversationId, input.actor.viewId]);
  const payloadHash = createHash('sha256').update(JSON.stringify(request.operations)).digest('hex');
  let result: CanvasCommitResult | undefined;
  let committedPlan: CanvasCommitPlan | undefined;
  input.database.transaction(() => {
    const receipt = readCanvasReceipt(input.database, { ...request, sourceKey });
    if (receipt) {
      if (receipt.payloadHash !== payloadHash) throw new Error('request_id_payload_mismatch');
      result = receipt.result;
      return;
    }
    const state = readCanvasCommitState(input.database, request.documentId);
    const claims = readCanvasEditingClaims(input.database, { documentId: request.documentId, viewId: input.actor.viewId, now: input.now });
    const plan = planCanvasCommit({ state, operations: request.operations, actor: input.actor, claims, now: input.now });
    result = { documentId: request.documentId, requestId: request.requestId, sequence: plan.state.sequence, results: plan.results, refs: plan.refs };
    persistCanvasCommit(input.database, { documentId: request.documentId, sourceKey, source: input.actor.source, plan, result, payloadHash, now: input.now });
    for (const participant of input.ports?.participants ?? []) participant.commit(plan);
    committedPlan = plan;
  }).immediate();
  if (committedPlan && committedPlan.changes.length > 0 && input.ports?.publish) {
    try { input.ports.publish(committedPlan); }
    catch (error) {
      // 数据已经提交，通知错误不能让调用方误以为写入回滚后重建同一批卡。
      input.ports.publicationFailed?.(error);
    }
  }
  return CanvasCommitResultSchema.parse(result);
}
