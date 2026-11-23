import type { ConversationActivity } from '@app/schemas';
import { isForegroundRootRun, selectCommandApprovalRunScope, selectStatusRun } from '../../conversation-control';
import type { ConversationActivityPorts } from '../definitions/conversationActivityPorts';
import { projectConversationActivity } from '../functions/projectConversationActivity';

/** 调用方先执行项目准入；批量只读 canonical registry 与同一 Commands 审批 owner。 */
export async function readConversationActivities(
  ports: ConversationActivityPorts,
  conversationIds: readonly string[],
  exactRuns?: ReadonlyMap<string, string>,
) {
  const candidates = await ports.runs.readCandidates(conversationIds, exactRuns && [...exactRuns.values()]);
  const activities: Record<string, ConversationActivity> = {};
  for (const conversationId of conversationIds) {
    const records = candidates.get(conversationId) ?? [];
    const exactRun = exactRuns?.get(conversationId);
    const run = exactRun === undefined ? selectStatusRun(conversationId, records)
      : records.find(record => record.runId === exactRun && isForegroundRootRun(record)) ?? null;
    if (!run) { activities[conversationId] = projectConversationActivity(null, 0); continue; }
    const scope = selectCommandApprovalRunScope(conversationId, run.runId, records);
    const approvals = ports.approvals.readControlPending(conversationId);
    activities[conversationId] = projectConversationActivity(run, approvals === undefined
      ? null : approvals.filter(approval => approval.status === 'awaiting_reply' && scope.has(approval.agent_run_id)).length);
  }
  return activities;
}

export async function readConversationActivity(ports: ConversationActivityPorts, conversationId: string) {
  const activities = await readConversationActivities(ports, [conversationId]);
  return activities[conversationId]!;
}
