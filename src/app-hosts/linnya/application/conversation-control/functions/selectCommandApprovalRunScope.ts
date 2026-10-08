import { ConversationControlError } from '../definitions/conversationControlError';
import type { ConversationControlRunRecord } from '../definitions/conversationControlUseCase';

/** 审批由实际子 run 发起；查 root 时只包含其后代，不混入同一会话的别轮运行。 */
export function selectCommandApprovalRunScope(
  conversationId: string,
  runId: string,
  records: readonly ConversationControlRunRecord[],
): ReadonlySet<string> {
  const runs = records.filter(run => run.conversationId === conversationId);
  if (!runs.some(run => run.runId === runId)) {
    throw new ConversationControlError('run_not_found', `Run ${runId} does not belong to conversation ${conversationId}`);
  }
  const selected = new Set([runId]);
  let previousSize = 0;
  while (selected.size !== previousSize) {
    previousSize = selected.size;
    for (const run of runs) {
      if (run.parentRunId && selected.has(run.parentRunId)) selected.add(run.runId);
    }
  }
  return selected;
}
