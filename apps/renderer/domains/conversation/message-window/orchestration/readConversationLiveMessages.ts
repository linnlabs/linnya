import type { BaseMessage } from '../../types';
import { useConversationState } from '../../store/conversationState';

/**
 * message-window loader 的默认 live read port adapter。
 * loader 本身只依赖窄函数合同，避免纯分页模块隐式初始化完整 Conversation store 图。
 */
export function readConversationLiveMessages(conversationId: string): readonly BaseMessage[] {
  const conversation = useConversationState().conversations.find(item => item.id === conversationId);
  return conversation?.messages ?? [];
}
