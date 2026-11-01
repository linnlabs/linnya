import type { AppUpdateActivity } from '../../../shared/update/definitions/updateMessage';
import type { AppUpdateActivitySnapshot } from '../definitions/appUpdatePorts';

/** 重启前需要用户知情的任务；key 用于判断确认之后是否出现了新任务。 */
export function resolveUpdateActivities(snapshot: AppUpdateActivitySnapshot): AppUpdateActivity[] {
  const activities: AppUpdateActivity[] = snapshot.activeAgentRuns.map(run => ({
    key: `conversation:${run.conversationId}`,
    kind: 'conversation',
    title: run.conversationTitle,
  }));
  if (snapshot.hasExecutingCommands) activities.push({ key: 'commands', kind: 'commands', title: null });
  if (snapshot.knowledgeIngestionActive) {
    activities.push({ key: 'knowledge_ingestion', kind: 'knowledge_ingestion', title: null });
  }
  return activities;
}
