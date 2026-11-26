import type { ConversationHistoryListItem } from '@app/schemas';

/** 同一项目里，距上一次活动不超过这个时长的 CLI 会话继续承接只给项目的工具调用。 */
export const CLI_TOOL_SESSION_IDLE_MS = 30 * 60_000;

/** 一次列出的最近会话数；CLI 会话按最近活动排在前面，超出范围的不再续用。 */
export const CLI_TOOL_SESSION_LOOKUP_LIMIT = 50;

/**
 * 只给项目的 CLI 工具调用续用哪一段会话：同项目、由 Linnya CLI 创建、最近活动未超时，取最近的一段。
 * 没有符合的就新建；调用方另行排除正在运行的会话。
 */
export function selectReusableCliToolSession(
  conversations: readonly ConversationHistoryListItem[],
  input: { readonly projectId: string; readonly now: number },
): ConversationHistoryListItem | undefined {
  return conversations
    .filter(conversation =>
      conversation.origin === 'linnya_cli'
      && conversation.project_id === input.projectId
      && input.now - conversation.last_event_at <= CLI_TOOL_SESSION_IDLE_MS)
    .reduce<ConversationHistoryListItem | undefined>(
      (latest, conversation) =>
        !latest || conversation.last_event_at > latest.last_event_at ? conversation : latest,
      undefined,
    );
}

/** CLI 新建会话的标题：入口名加本机时间，中英文界面都能读。 */
export function formatCliToolSessionTitle(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `Linnya CLI · ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
