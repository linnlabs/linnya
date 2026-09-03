import type {
  ConversationInputChatExecutionSource,
  HostConversationInputExtension,
  ResolvedConversationInputExecution,
} from '../definitions/conversationInputExtensions';

export function resolveConversationInputExecution(
  chat: ConversationInputChatExecutionSource,
  activeExtension: HostConversationInputExtension | null,
): ResolvedConversationInputExecution {
  const extensionRunning = activeExtension?.executionState.status.value === 'running';
  return {
    isLoading: chat.isLoading() || extensionRunning,
    isStreaming: chat.isStreaming() || extensionRunning,
    // 与旧宿主语义一致：扩展运行时停止当前扩展，否则停止普通 chat run。
    cancel: extensionRunning
      ? activeExtension.executionState.cancel
      : chat.cancel,
  };
}
