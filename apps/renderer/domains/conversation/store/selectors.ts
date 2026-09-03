/**
 * @file apps/renderer/domains/conversation/store/selectors.ts
 * @description 选择器模块 - 派生计算属性
 * 
 * @brief 设计理念
 * 功能 (What): 基于对话状态创建派生的计算属性，提供便捷的数据访问
 * 输入 (Input): 对话状态的响应式引用
 * 输出 (Output): 派生的计算属性
 * 副作用 (Side-effects): 无，纯计算函数
 * 
 * @principles 设计原则
 * 1. 高内聚：所有派生计算逻辑集中管理
 * 2. 低耦合：只依赖传入的状态参数，不直接访问外部状态
 * 3. 响应式：使用Vue的computed保证响应式更新
 * 4. 纯函数：计算属性应该是纯函数，无副作用
 */

import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import type { Conversation, BaseMessage } from '../types';
import type { useConversationState } from './conversationState';
import {
  hasRenderableConversationMessages,
  isRenderableConversationMessage,
} from '../functions/renderableConversationMessage';
import {
  mergeWindowAndLiveMessages,
  useMessageWindowStore,
} from '../message-window';
import { findLatestTodoToolMessageId } from '../functions/latestTodoToolMessage';
import { aggregateCommandExecutionMessages } from '../features/command-execution-presentation/functions/aggregateCommandExecutionMessages';

/**
 * 对话选择器组合函数
 * 
 * @description
 * 基于对话状态创建派生的计算属性
 * 这些计算属性会自动响应状态变化，为UI组件提供便捷的数据访问
 * 
 * @param conversationState 对话状态对象
 * @returns 包含所有选择器计算属性的对象
 */
export function useConversationSelectors(conversationState: ReturnType<typeof useConversationState>) {
  const { activeConversationId, conversations } = storeToRefs(conversationState);
  const messageWindowStore = useMessageWindowStore();
  
  /**
   * 活跃对话对象
   * 
   * @description
   * 基于activeConversationId从conversations列表中找到对应的对话对象
   * 如果没有活跃对话ID或找不到对应对话，返回null
   */
  const activeConversation = computed<Conversation | null>(() => {
    if (!activeConversationId.value) {
      return null;
    }
    return conversations.value.find(c => c.id === activeConversationId.value) ?? null;
  });

  /**
   * 是否有活跃对话
   * 
   * @description
   * 简单的布尔值，表示当前是否有活跃的对话
   * 这是一个常用的判断条件，单独提取出来便于使用
   */
  const hasActiveConversation = computed<boolean>(() => {
    return activeConversation.value !== null;
  });

  /**
   * 活跃对话的消息列表（window ∪ live 合成视图）
   * 
   * @description
   * Phase 3 后 `conversation.messages` 只代表 live 投影槽；
   * 历史窗口数据留在 messageWindowStore，渲染侧统一从这里读取合成视图。
   */
  const activeMessages = computed<BaseMessage[]>(() => {
    const liveMessages = activeConversation.value?.messages ?? [];
    if (
      activeConversationId.value
      && messageWindowStore.conversationId === activeConversationId.value
      && messageWindowStore.rows.length > 0
    ) {
      return aggregateCommandExecutionMessages(mergeWindowAndLiveMessages(messageWindowStore.rows, liveMessages, {
        hasMoreAfter: messageWindowStore.hasMoreAfter,
      }).messages);
    }

    return aggregateCommandExecutionMessages(liveMessages);
  });

  /**
   * 当前活跃对话的可渲染消息。
   *
   * 中文说明：
   * - 草稿对话、表格逐行 hidden user_input、tool_output 等都可能让底层 messages 非空；
   * - UI 空态只能看“用户真的能看到的内容”，不能再直接用 messages.length。
   */
  const activeRenderableMessages = computed<BaseMessage[]>(() => {
    return activeMessages.value.filter(isRenderableConversationMessage);
  });

  const hasRenderableMessages = computed<boolean>(() => {
    return hasRenderableConversationMessages(activeMessages.value);
  });

  const activeMessageWindowIncludesConversationTail = computed<boolean>(() => {
    const conversationId = activeConversationId.value;
    if (!conversationId) return false;

    const hasActiveWindow = messageWindowStore.conversationId === conversationId
      && messageWindowStore.rows.length > 0;
    return !hasActiveWindow || !messageWindowStore.hasMoreAfter;
  });

  const latestTodoToolMessageId = computed<string | null>(() => (
    findLatestTodoToolMessageId(
      activeMessages.value,
      activeMessageWindowIncludesConversationTail.value,
    )
  ));

  return {
    activeConversation,
    hasActiveConversation,
    activeMessages,
    activeRenderableMessages,
    hasRenderableMessages,
    activeMessageWindowIncludesConversationTail,
    latestTodoToolMessageId,
  };
}

/**
 * 默认导出：便捷的选择器创建函数
 */
export default useConversationSelectors; 
