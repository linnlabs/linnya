import { ConversationControlStatusResponseSchema } from '@app/schemas';
import type { CanvasEvaluationRunnerState } from '../definitions/evaluationRunner';
import { readEvaluationRunReceipts } from './readEvaluationRunReceipts';

export function assertApprovalPriorRun(state: CanvasEvaluationRunnerState, value: unknown) {
  const [first] = readEvaluationRunReceipts(state),
    prior = ConversationControlStatusResponseSchema.parse(value);
  if (
    prior.conversation_id !== first.conversation_id ||
    prior.run?.run_id !== first.run_id ||
    prior.run.status !== 'completed'
  )
    throw new Error(
      'Only a completed first run may receive an approval notification; failed or active runs cannot retry'
    );
}
