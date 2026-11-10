import { isDeepStrictEqual } from 'node:util';
import { CanvasEvaluationControlsEvidenceSchema } from '../../definitions/canvasEvaluationWitness';
import type { CanvasEvaluationRunnerState } from '../definitions/evaluationRunner';

export function admitApprovalContinuation(state: CanvasEvaluationRunnerState, value: unknown) {
  if (state.phase !== 'started' || !state.receipt) throw new Error('No confirmed first model run');
  if (state.config.taskId !== 'T9' && state.config.taskId !== 'T12')
    throw new Error('Only T9/T12 admit approval continuation');
  if (state.continuations?.length) throw new Error('Approval continuation already confirmed');
  return admitApprovalWitness(state, value);
}
export function admitApprovalWitness(state: CanvasEvaluationRunnerState, value: unknown) {
  if (!state.receipt || (state.config.taskId !== 'T9' && state.config.taskId !== 'T12'))
    throw new Error('Approval witness has no original approval task');
  const witness = CanvasEvaluationControlsEvidenceSchema.parse(value);
  const expected = {
    sourceRevision: state.config.sourceRevision,
    batchId: state.config.batchId,
    documentId: state.documentId,
    conversationId: state.receipt.conversation_id,
    runId: state.receipt.run_id,
  };
  if (!isDeepStrictEqual(witness.scope, expected))
    throw new Error('Approval witness belongs to another evaluation run');
  const decision: 'allow' | 'deny' = state.config.taskId === 'T9' ? 'allow' : 'deny';
  if (!witness.approvalShown || witness.approvalDecision !== decision)
    throw new Error('Real UI approval witness does not match fixed task decision');
  const prompt =
    decision === 'allow' ? '已在画布允许，请继续检查结果。' : '已在画布拒绝，请确认结果。';
  return { witness, decision, prompt };
}
