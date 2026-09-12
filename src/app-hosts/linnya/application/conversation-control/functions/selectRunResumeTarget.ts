import type { ConversationControlResumeRequest } from '@app/schemas';
import { ConversationControlError } from '../definitions/conversationControlError';
import type { ConversationControlRunRecord } from '../definitions/conversationControlUseCase';
import { selectStatusRun } from './selectForegroundRun';

export interface ConversationControlRunResumeTarget {
  readonly run: ConversationControlRunRecord;
  readonly turnId: string;
}

/** 选择并验证一次 exact settled-pause 快照；最终原子裁决仍由 RunSupervisor 完成。 */
export function selectRunResumeTarget(
  request: ConversationControlResumeRequest,
  runs: readonly ConversationControlRunRecord[]
): ConversationControlRunResumeTarget {
  const run = selectStatusRun(request.conversation_id, runs, request.expected_run_id);
  if (!run || run.status !== 'paused' || run.pausedAt === undefined) {
    const guidance = run?.status === 'awaiting_user'
      ? 'This run is awaiting an interaction response; use linnya respond instead.'
      : 'Only a settled paused run can be resumed.';
    throw new ConversationControlError(
      'unsupported_runtime_state',
      `${guidance} Run ${request.expected_run_id} is ${run?.status ?? 'unavailable'}.`
    );
  }
  const executionId = run.metadata?.executionId;
  if (
    executionId !== request.expected_execution_id
    || run.updatedAt !== request.expected_updated_at
  ) {
    throw new ConversationControlError(
      'run_mismatch',
      `Run ${run.runId} changed after it was observed; read status and retry with the new pause identity`,
      true
    );
  }
  const turnId = run.metadata?.turnId;
  if (typeof turnId !== 'string' || turnId.trim().length === 0) {
    throw new ConversationControlError(
      'internal_error',
      `Run ${run.runId} is missing its stable turn identity`
    );
  }
  return { run, turnId };
}
