import type { ConversationActivityList } from '@app/schemas';
import type { ConversationActivityListPorts } from '../definitions/conversationActivityPorts';
import { readConversationActivities } from './readConversationActivity';

/**
 * 全工作区的非空闲对话，供侧栏一次读取。先用状态索引取候选超集，再走与单个对话相同的
 * 批量投影；空闲（含最近一次已完成）不返回。调用方是同一 Desktop 的本机界面，不按项目授权裁剪。
 */
export async function listConversationActivities(ports: ConversationActivityListPorts): Promise<ConversationActivityList> {
  const candidates = await ports.runs.listActivityCandidates();
  if (candidates.length === 0) return { conversations: [] };
  const activities = await readConversationActivities(ports, candidates.map(candidate => candidate.conversationId));
  return {
    conversations: candidates.flatMap(candidate => {
      const activity = activities[candidate.conversationId];
      if (!activity || activity.state === 'idle') return [];
      return [{ conversation_id: candidate.conversationId, project_id: candidate.projectId, activity }];
    }),
  };
}
