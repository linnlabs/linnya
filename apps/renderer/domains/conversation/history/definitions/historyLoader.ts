import type { Conversation } from '../../types';
import type { ConversationSelectedAgentId } from '@app/schemas';

export interface HistoryConversationSnapshot {
  title?: string | null;
  created_at?: number;
  last_event_at?: number;
  user_message_count?: number;
  project_id?: string | null;
  selected_agent_id?: ConversationSelectedAgentId | null;
}

export interface LoadConversationOptions {
  initialConversation?: HistoryConversationSnapshot | null;
  loadingIntent?: HistoryLoadingIntent | null;
}

/**
 * 导航只能在本次加载世代真正提交后记录“最近打开的对话”。
 * `stale` 表示控制权已经交给更新的导航或删除流程；`failed` 表示当前世代执行失败。
 */
export type HistoryConversationLoadResult =
  | { readonly status: 'committed'; readonly conversationId: string }
  | { readonly status: 'stale'; readonly conversationId: string }
  | { readonly status: 'failed'; readonly conversationId: string; readonly error: string };

/**
 * HistoryLoader 只报告自己失效了哪一代 loading buffer，不直接修改其它 store。
 * 跨 store 的释放顺序由删除 orchestration 统一持有。
 */
export interface HistoryConversationLoadInvalidationResult {
  readonly bufferRequestToken: number | null;
  readonly ownsLoadingState: boolean;
}

export interface HistoryLoadingIntent {
  conversationId: string;
  requestToken: number;
}

export interface PreparedHistoryLoadingShell {
  conversationId: string;
  requestToken: number;
  previousConversationId: string | null;
  fallbackConversation: Conversation | null;
}
