import type { ConversationActivity } from '@app/schemas';
import type { ConversationControlRunRecord } from '../../conversation-control';

/** 只解释运行事实。已中断不是未读标记，读取与再次查看都不能把它清掉。 */
export function projectConversationActivity(
  run: ConversationControlRunRecord | null,
  pendingApprovalCount: number | null,
): ConversationActivity {
  if (!run) {
    return { state: 'idle', source: 'none', run_id: null, run_status: null, reason: null, updated_at: null,
      pause: null, pending_approval_count: 0 };
  }
  const settled = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled'
    || (run.status === 'paused' && run.pausedAt !== undefined);
  let state: ConversationActivity['state'];
  if (settled) state = run.status === 'completed' ? 'idle' : 'interrupted';
  else if (pendingApprovalCount === null) state = 'unavailable';
  else if (pendingApprovalCount > 0) state = 'awaiting_approval';
  else if (run.status === 'awaiting_user') state = 'awaiting_answer';
  else state = 'running';
  return {
    state, source: 'run_registry', run_id: run.runId, run_status: run.status, updated_at: run.updatedAt,
    reason: state === 'unavailable' ? 'approval_unavailable'
      : run.status === 'cancelled' || run.status === 'failed' || run.status === 'paused' ? run.status : null,
    pause: run.status === 'paused' ? { settled: run.pausedAt !== undefined, reason: run.pauseReason } : null,
    pending_approval_count: settled ? 0 : pendingApprovalCount,
  };
}
