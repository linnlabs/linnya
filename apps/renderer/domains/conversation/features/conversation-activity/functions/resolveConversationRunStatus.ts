import type { ConversationActivity } from '@app/schemas';
import {
  CONVERSATION_RUN_STATUS_PRIORITY,
  type ConversationInterruptionSeenRecord,
  type ConversationRunStatus,
  type ConversationRunStatusSummary,
} from '../definitions/conversationRunStatus';

export function isInterruptionSeen(
  conversationId: string,
  activity: ConversationActivity,
  seen: ConversationInterruptionSeenRecord,
): boolean {
  if (activity.run_id !== null && seen.seenRunIds[conversationId] === activity.run_id) return true;
  return activity.updated_at !== null && activity.updated_at <= seen.baselineAt;
}

/**
 * Host 运行状态 → 侧栏记号。审批端读不到（unavailable）时运行仍未收口，按进行中显示；
 * 中断看过后不再显示，进行中和等你处理只随运行本身结束。
 */
export function resolveConversationRunStatus(
  conversationId: string,
  activity: ConversationActivity | undefined,
  seen: ConversationInterruptionSeenRecord,
): ConversationRunStatus | null {
  if (!activity) return null;
  switch (activity.state) {
    case 'running':
    case 'unavailable':
      return 'running';
    case 'awaiting_answer':
      return 'awaiting-answer';
    case 'awaiting_approval':
      return 'awaiting-approval';
    case 'interrupted':
      return isInterruptionSeen(conversationId, activity, seen) ? null : 'interrupted';
    case 'idle':
      return null;
  }
}

export function isAwaitingUser(status: ConversationRunStatus | null): boolean {
  return status === 'awaiting-answer' || status === 'awaiting-approval';
}

export function summarizeConversationRunStatuses(
  statuses: Iterable<ConversationRunStatus | null>,
): ConversationRunStatusSummary | null {
  const counts = new Map<ConversationRunStatus, number>();
  for (const status of statuses) if (status) counts.set(status, (counts.get(status) ?? 0) + 1);
  const status = CONVERSATION_RUN_STATUS_PRIORITY.find(candidate => counts.has(candidate));
  return status ? { status, count: counts.get(status)! } : null;
}

/**
 * 只保留仍然有效的记录：对话还在列表里，且当前运行就是记下的那次。新运行开始或对话
 * 回到空闲后删除；本窗口先记下、尚未收口的暂停与取消因为运行编号相同而保留。
 */
export function retainSeenRunIds(
  seenRunIds: Readonly<Record<string, string>>,
  activities: ReadonlyMap<string, ConversationActivity>,
): Record<string, string> {
  const retained: Record<string, string> = {};
  for (const [conversationId, runId] of Object.entries(seenRunIds)) {
    if (activities.get(conversationId)?.run_id === runId) retained[conversationId] = runId;
  }
  return retained;
}
