import type { ConversationUserInputCommittedEvent } from '@app/schemas';
import type { WorkspaceScope } from '../../../../shared/stores/workspaceScopeStore';
import { useConversationTitleFeature } from '../../features/conversation-title';
import { scheduleSyncConversationToHistory } from '../../history/orchestration/scheduleSyncConversationToHistory';

export interface OrchestrateCommittedConversationTitleInput {
  readonly event: ConversationUserInputCommittedEvent;
  readonly wasNewConversation: boolean;
  readonly scope: WorkspaceScope;
  readonly onHistorySynced?: () => void;
}

/**
 * 统一编排 durable 首问之后的标题与历史列表展示。
 *
 * `user_input_committed` 已经证明 conversation 和首问完成事务提交，所以标题不再等待
 * history metadata 轮询。新会话则等 fallback 写入结束后再进入历史列表，避免后端默认占位
 * 标题在 UI 中短暂闪现；标题写入失败也会继续同步历史，不能让会话永久不可见。
 */
export function orchestrateCommittedConversationTitle(
  input: OrchestrateCommittedConversationTitleInput,
): void {
  const fallbackSettled = useConversationTitleFeature().handleUserMessage({
    conversationId: input.event.conversation_id,
    userText: input.event.raw_content,
  });

  if (!input.wasNewConversation) return;

  void fallbackSettled.then(() => {
    scheduleSyncConversationToHistory(input.event.conversation_id, {
      scope: input.scope,
      lastEventAtOverride: input.event.timestamp,
      onSynced: input.onHistorySynced,
    });
  });
}
