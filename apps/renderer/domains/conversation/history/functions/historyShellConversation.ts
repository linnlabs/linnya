import type { Conversation } from '../../types';
import type { HistoryConversationSnapshot } from '../definitions/historyLoader';

export function createHistoryShellConversation(
  conversationId: string,
  metadata: HistoryConversationSnapshot | null,
  fallbackConversation: Conversation | null,
): Conversation {
  const now = Date.now();
  return {
    id: conversationId,
    title: metadata?.title || fallbackConversation?.title || '',
    titleOrigin: fallbackConversation?.titleOrigin ?? 'explicit',
    /**
     * 历史 window 与 live projection 是两份独立 read model。已有 conversation 的 messages
     * 是该会话仍在接收的 live slot，切换 loading 壳时必须保留；历史行由 window store 合并，
     * 不能为了显示 loading 就销毁后台 run 已经投影的 chunk / thought / tool 状态。
     */
    messages: fallbackConversation ? [...fallbackConversation.messages] : [],
    createdAt: metadata?.created_at ?? fallbackConversation?.createdAt ?? now,
    updatedAt: metadata?.last_event_at ?? fallbackConversation?.updatedAt ?? now,
    userMessageCount: metadata?.user_message_count ?? fallbackConversation?.userMessageCount,
    selectedAgentId: metadata?.selected_agent_id ?? fallbackConversation?.selectedAgentId ?? null,
    metadata: {
      ...(fallbackConversation?.metadata ?? {}),
      projectId: metadata?.project_id ?? fallbackConversation?.metadata?.projectId,
    },
  };
}
