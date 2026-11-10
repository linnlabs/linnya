import type { CanvasEvaluationRunnerState } from '../definitions/evaluationRunner';
import type { ConversationControlAcceptedReceipt } from '@app/schemas';

/** 原run永远排第一；只有已持久确认、同会话的审批通知能扩展允许的root范围。 */
export function readEvaluationRunReceipts(
  state: CanvasEvaluationRunnerState
): readonly [ConversationControlAcceptedReceipt, ...ConversationControlAcceptedReceipt[]] {
  if (!state.receipt) throw new Error('No confirmed model run');
  const continuations = state.continuations ?? [];
  if (continuations.length && state.config.taskId !== 'T9' && state.config.taskId !== 'T12')
    throw new Error('Only approval tasks admit a continuation');
  for (const continuation of continuations) {
    if (
      continuation.receipt.conversation_id !== state.receipt.conversation_id ||
      continuation.receipt.run_id === state.receipt.run_id
    )
      throw new Error('Continuation must be a new run in the original conversation');
    if (continuation.decision !== (state.config.taskId === 'T9' ? 'allow' : 'deny'))
      throw new Error('Continuation decision conflicts with fixed task');
  }
  return [state.receipt, ...continuations.map(value => value.receipt)];
}
