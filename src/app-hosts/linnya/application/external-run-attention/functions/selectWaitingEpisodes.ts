import type { ConversationActivityList } from '@app/schemas';

import type { WaitingEpisode } from '../definitions/externalRunAttention';

/** 正在等用户的对话。审批端读不到（unavailable）时不知道是不是在等，不算。 */
export function selectWaitingEpisodes(list: ConversationActivityList): readonly WaitingEpisode[] {
  return list.conversations.flatMap(({ conversation_id, project_id, activity }) => {
    if (activity.run_id === null) return [];
    if (activity.state !== 'awaiting_approval' && activity.state !== 'awaiting_answer') return [];
    return [{ conversationId: conversation_id, projectId: project_id, runId: activity.run_id, kind: activity.state }];
  });
}

export function waitingEpisodeKey(episode: WaitingEpisode): string {
  return `${episode.runId}:${episode.kind}`;
}
